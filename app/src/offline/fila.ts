/**
 * Fila de envio dos registros guardados no aparelho. Envia um de cada vez
 * (ordem de criação), reaproveitando `enviarRegistro`, que é idempotente.
 */
import { ErroEnvio, type TipoErroEnvio } from '../dados/erros.ts'
import { enviarRegistro, type Progresso, type Rascunho } from '../dados/envio.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import type { FotoPreparada } from '../util/imagem.ts'
import type { Armazenamento, RegistroLocal } from './armazenamento.ts'

export type EstadoItem = 'aguardando' | 'enviando' | 'erro'
export interface ItemFila {
  registro: RegistroLocal
  estado: EstadoItem
  progresso: Progresso | null
}
export interface EstadoFila {
  carregada: boolean
  itens: ItemFila[] // do usuário atual, por criadoEm decrescente (mais recente primeiro)
  sincronizando: boolean
  /** Última falha transitória (rede ou sessão), para a barra; null depois de um envio bem-sucedido. */
  semConexao: boolean
  persistente: boolean
}
export interface NovoLocal {
  rascunho: Rascunho
  obra: { slug: string; nome: string }
  ambiente: { codigo: string; nome: string }
}
export interface Fila {
  obterEstado(): EstadoFila // referência estável até a próxima mudança (useSyncExternalStore)
  assinar(fn: () => void): () => void
  /** Grava no armazenamento e só então resolve; depois dispara sincronizar() sem esperar. */
  adicionar(n: NovoLocal): Promise<void>
  sincronizar(): Promise<void>
  tentarDeNovo(id: string): Promise<void> // limpa `erro`, grava e sincroniza
  descartar(id: string): Promise<void> // ignorado se o item estiver enviando
  /** Carrega os itens, liga os gatilhos e devolve a função que os desliga. */
  iniciar(): () => void
}

/** Atrasos (ms) das novas tentativas automáticas; o último se repete. */
export const ATRASOS_MS = [15_000, 30_000, 60_000, 120_000, 300_000]

const TIPOS_TRANSITORIOS: TipoErroEnvio[] = ['rede', 'sessao']
const MENSAGEM_SEM_FOTOS = 'As fotos deste registro não foram encontradas no aparelho.'

async function blobParaBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(leitor.result as ArrayBuffer)
    leitor.onerror = () => reject(leitor.error ?? new Error('Falha ao ler a foto.'))
    leitor.readAsArrayBuffer(blob)
  })
}

export function criarFila(o: {
  repo: Repositorio
  armazenamento: Armazenamento
  usuarioId: string
  /** Chamado depois de cada envio bem-sucedido, antes de tirar o item da memória (invalida as consultas). */
  aoEnviar?: (r: RegistroLocal) => Promise<void>
}): Fila {
  const { repo, armazenamento, usuarioId, aoEnviar } = o
  const itens = new Map<string, ItemFila>()
  const ouvintes = new Set<() => void>()
  let carregada = false
  let sincronizando = false
  let semConexao = false
  let estado: EstadoFila = montarEstado()

  let emVoo: Promise<void> | null = null
  let repetir = false
  let parado = false
  let indiceAtraso = 0
  let temporizador: ReturnType<typeof setTimeout> | null = null

  function montarEstado(): EstadoFila {
    return {
      carregada,
      itens: [...itens.values()].sort((a, b) =>
        b.registro.criadoEm.localeCompare(a.registro.criadoEm),
      ),
      sincronizando,
      semConexao,
      persistente: armazenamento.persistente,
    }
  }

  /** Cria um novo objeto de estado (só aqui) e avisa os assinantes. */
  function publicar(): void {
    estado = montarEstado()
    for (const fn of [...ouvintes]) fn()
  }

  function trocar(id: string, mudanca: Partial<ItemFila>): void {
    const atual = itens.get(id)
    if (atual) itens.set(id, { ...atual, ...mudanca })
  }

  function limparTemporizador(): void {
    if (temporizador !== null) clearTimeout(temporizador)
    temporizador = null
  }

  function agendarNovaTentativa(): void {
    limparTemporizador()
    if (parado) return
    const atraso = ATRASOS_MS[Math.min(indiceAtraso, ATRASOS_MS.length - 1)]
    indiceAtraso++
    temporizador = setTimeout(() => {
      temporizador = null
      void sincronizar()
    }, atraso)
  }

  async function montarRascunho(r: RegistroLocal): Promise<Rascunho | null> {
    const fotos: FotoPreparada[] = []
    for (const f of r.fotos) {
      const dados = await armazenamento.lerFoto(r.id, f.id)
      if (!dados) return null
      fotos.push({
        id: f.id,
        blob: new Blob([dados], { type: 'image/jpeg' }),
        largura: f.largura,
        altura: f.altura,
        bytes: f.bytes,
      })
    }
    return {
      id: r.id,
      obraId: r.obra.id,
      ambienteId: r.ambiente.id,
      tipo: r.tipo,
      legenda: r.legenda,
      capturadoEm: r.capturadoEm,
      fotos,
    }
  }

  async function marcarErro(r: RegistroLocal, tipo: TipoErroEnvio, mensagem: string): Promise<void> {
    const comErro: RegistroLocal = { ...r, erro: { tipo, mensagem } }
    try {
      await armazenamento.atualizar(comErro)
    } catch {
      // Segue com o erro só na memória; na próxima carga o item tenta de novo.
    }
    itens.set(r.id, { registro: comErro, estado: 'erro', progresso: null })
    publicar()
  }

  /** Devolve true se a rodada deve parar (falha transitória que bloqueia os demais). */
  async function enviarItem(r: RegistroLocal, falhou: { transitorio: boolean }): Promise<boolean> {
    trocar(r.id, { estado: 'enviando', progresso: null })
    publicar()
    try {
      const rascunho = await montarRascunho(r)
      if (!rascunho) {
        await marcarErro(r, 'validacao', MENSAGEM_SEM_FOTOS)
        return false
      }
      await enviarRegistro(repo, rascunho, (p) => {
        trocar(r.id, { progresso: p })
        publicar()
      })
      await armazenamento.remover(r.id)
      try {
        await aoEnviar?.(r)
      } catch {
        // Falha ao invalidar consultas não pode quebrar a fila.
      }
      itens.delete(r.id)
      indiceAtraso = 0
      semConexao = false
      publicar()
      return false
    } catch (e) {
      if (e instanceof ErroEnvio && !TIPOS_TRANSITORIOS.includes(e.tipo) && e.tipo !== 'desconhecido') {
        await marcarErro(r, e.tipo, e.message)
        return false
      }
      const bloqueia = !(e instanceof ErroEnvio && e.tipo === 'desconhecido')
      falhou.transitorio = true
      trocar(r.id, { estado: 'aguardando', progresso: null })
      if (bloqueia) semConexao = true
      publicar()
      return bloqueia
    }
  }

  async function rodada(): Promise<void> {
    const falhou = { transitorio: false }
    const fila = [...itens.values()]
      .filter((i) => i.estado === 'aguardando' && i.registro.erro === null)
      .sort((a, b) => a.registro.criadoEm.localeCompare(b.registro.criadoEm))
    for (const item of fila) {
      if (parado) return
      // O item pode ter sido descartado enquanto esperava a vez.
      const atual = itens.get(item.registro.id)
      if (!atual || atual.estado !== 'aguardando') continue
      if (await enviarItem(atual.registro, falhou)) break
    }
    if (falhou.transitorio && !repetir && !parado) agendarNovaTentativa()
  }

  function sincronizar(): Promise<void> {
    if (parado) return Promise.resolve()
    if (emVoo) {
      repetir = true
      return emVoo
    }
    sincronizando = true
    publicar()
    emVoo = (async () => {
      try {
        do {
          repetir = false
          await rodada()
        } while (repetir && !parado)
      } catch {
        // Nunca rejeita: o que falhar volta na próxima tentativa.
      } finally {
        emVoo = null
        sincronizando = false
        publicar()
      }
    })()
    return emVoo
  }

  async function carregar(): Promise<void> {
    try {
      const salvos = await armazenamento.listar(usuarioId)
      for (const r of salvos) {
        if (!itens.has(r.id)) {
          itens.set(r.id, { registro: r, estado: r.erro ? 'erro' : 'aguardando', progresso: null })
        }
      }
    } catch {
      // Sem leitura do aparelho: segue só com o que está na memória.
    }
    carregada = true
    publicar()
  }

  return {
    obterEstado: () => estado,

    assinar(fn) {
      ouvintes.add(fn)
      return () => {
        ouvintes.delete(fn)
      }
    },

    async adicionar({ rascunho, obra, ambiente }) {
      const registro: RegistroLocal = {
        id: rascunho.id,
        usuarioId,
        obra: { id: rascunho.obraId, slug: obra.slug, nome: obra.nome },
        ambiente: { id: rascunho.ambienteId, codigo: ambiente.codigo, nome: ambiente.nome },
        tipo: rascunho.tipo,
        legenda: rascunho.legenda,
        capturadoEm: rascunho.capturadoEm,
        criadoEm: new Date().toISOString(),
        fotos: rascunho.fotos.map((f) => ({
          id: f.id,
          largura: f.largura,
          altura: f.altura,
          bytes: f.bytes,
        })),
        erro: null,
      }
      const dados = await Promise.all(
        rascunho.fotos.map(async (f) => ({ id: f.id, dados: await blobParaBuffer(f.blob) })),
      )
      await armazenamento.salvar(registro, dados)
      itens.set(registro.id, { registro, estado: 'aguardando', progresso: null })
      publicar()
      void sincronizar()
    },

    sincronizar,

    async tentarDeNovo(id) {
      const item = itens.get(id)
      if (!item || item.estado !== 'erro') return
      const registro: RegistroLocal = { ...item.registro, erro: null }
      await armazenamento.atualizar(registro)
      itens.set(id, { registro, estado: 'aguardando', progresso: null })
      publicar()
      await sincronizar()
    },

    async descartar(id) {
      const item = itens.get(id)
      if (!item || item.estado === 'enviando') return
      await armazenamento.remover(id)
      itens.delete(id)
      publicar()
    },

    iniciar() {
      parado = false
      void carregar().then(() => sincronizar())

      const aoFicarOnline = () => {
        indiceAtraso = 0
        limparTemporizador()
        void sincronizar()
      }
      const aoMudarVisibilidade = () => {
        if (document.visibilityState === 'visible') void sincronizar()
      }
      window.addEventListener('online', aoFicarOnline)
      document.addEventListener('visibilitychange', aoMudarVisibilidade)

      return () => {
        parado = true
        limparTemporizador()
        window.removeEventListener('online', aoFicarOnline)
        document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      }
    },
  }
}
