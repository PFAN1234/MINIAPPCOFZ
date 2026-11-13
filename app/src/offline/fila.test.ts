import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarRascunho, criarRascunhoEncerramento } from '../dados/envio.ts'
import { ErroEnvio, MENSAGEM_REDE } from '../dados/erros.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import {
  abrirArmazenamento,
  criarArmazenamentoMemoria,
  type Armazenamento,
  type EncerramentoLocal,
  type ObservacaoLocal,
  type RegistroLocal,
} from './armazenamento.ts'
import {
  criarFila,
  type Fila,
  type NovaObservacaoLocal,
  type NovoEncerramentoLocal,
  type NovoLocal,
} from './fila.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const AMB = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e99'

/** Repositório falso idempotente: conta registros por id. */
function criarRepoFalso() {
  const registros = new Map<string, number>()
  const encerramentos = new Map<string, number>()
  /** Observações gravadas por id (texto) e quantas chamadas cada id recebeu. */
  const observacoes = new Map<string, string>()
  const fotosEnviadas: string[] = []
  const estado = {
    rede: true,
    definitivas: new Set<string>(),
    perderRespostaDe: new Set<string>(),
    tentativas: [] as string[],
    tentativasEncerramento: [] as string[],
    jaEncerradas: new Set<string>(),
    tentativasObservacao: [] as string[],
    /** Dia emitido: `salvarObservacao` responde 22023. */
    diaEmitido: false,
    /** Ids de observação que respondem 42501 (permissão). */
    semPermissao: new Set<string>(),
  }
  const repo: Repositorio = {
    async idUsuario() {
      return 'u1'
    },
    async obterGeometria() {
      return null
    },
    async listarObras() {
      return []
    },
    async listarModelos() {
      return []
    },
    async souAdmin() {
      return false
    },
    async etapasInicio() {
      return []
    },
    async equipeServico() {
      throw new Error('n/a')
    },
    async fazerCheckin() {
      throw new Error('n/a')
    },
    async fazerCheckout() {
      throw new Error('n/a')
    },
    async organizacao() {
      return { nome: 'CO-FZ', logo_url: null }
    },
    async criarLinkAdmin() {
      throw new Error('n/a')
    },
    async baixarModelo() {
      throw new Error('n/a')
    },
    async obrasDisponiveis() {
      return []
    },
    async solicitarAcesso() {},
    async listarSolicitacoes() {
      return []
    },
    async decidirSolicitacao() {},
    async localizarRegistro() {
      return null
    },
    async obterObra() {
      throw new Error('n/a')
    },
    async obterAmbiente() {
      throw new Error('n/a')
    },
    async listarRegistros() {
      return []
    },
    async urlsImagens() {
      return {}
    },
    async enviarFoto({ registroId, fotoId }) {
      estado.tentativas.push(registroId)
      if (!estado.rede) throw new ErroEnvio('rede', MENSAGEM_REDE)
      fotosEnviadas.push(`${registroId}/${fotoId}`)
    },
    async obterPendencia() {
      return null
    },
    async encerrarPendencia(d) {
      estado.tentativasEncerramento.push(d.id)
      if (!estado.rede) throw new ErroEnvio('rede', MENSAGEM_REDE)
      if (estado.jaEncerradas.has(d.registroId)) {
        throw new ErroEnvio('conflito', 'Esta pendência já foi encerrada.')
      }
      if (!encerramentos.has(d.id)) encerramentos.set(d.id, 0)
      encerramentos.set(d.id, encerramentos.get(d.id)! + 1)
      return { id: d.id }
    },
    async listarParticipantes() {
      return []
    },
    async definirPapel() {},
    async removerParticipante() {},
    async listarPublicacoesProblema() {
      return []
    },
    async republicar() {},
    async marcarPublicada() {},
    async observacoesDoDia() {
      return { data: '2026-11-13', fuso: 'America/Fortaleza', travada: false, observacoes: [] }
    },
    async salvarObservacao(d) {
      estado.tentativasObservacao.push(d.id)
      if (!estado.rede) throw new ErroEnvio('rede', MENSAGEM_REDE)
      if (estado.diaEmitido) {
        throw new ErroEnvio('validacao', 'O boletim de 13/11/2026 já foi emitido; a correção é feita por retificação')
      }
      if (estado.semPermissao.has(d.id)) throw new ErroEnvio('permissao', 'Sem permissão nesta obra')
      observacoes.set(d.id, d.texto)
      return {
        id: d.id,
        data: '2026-11-13',
        texto: d.texto,
        escrito_em: d.escritoEm,
        editado_em: null,
        autor: { id: 'u1', nome: 'CP PATRICIO' },
        minha: true,
        travada: false,
      }
    },
    async excluirObservacao() {},
    async concluirRegistro(d) {
      if (!estado.rede) throw new ErroEnvio('rede', MENSAGEM_REDE)
      if (estado.definitivas.has(d.id)) throw new ErroEnvio('validacao', 'Legenda inválida')
      if (!registros.has(d.id)) registros.set(d.id, 0)
      registros.set(d.id, registros.get(d.id)! + 1)
      if (estado.perderRespostaDe.delete(d.id)) throw new ErroEnvio('rede', MENSAGEM_REDE)
      return { id: d.id }
    },
  }
  return { repo, registros, encerramentos, observacoes, fotosEnviadas, estado }
}

function novaObservacao(texto = 'Chuva forte à tarde'): NovaObservacaoLocal {
  return {
    id: crypto.randomUUID(),
    obra: { id: OBRA, slug: 'hto', nome: 'HTO' },
    texto,
    escritoEm: new Date().toISOString(),
  }
}

function novo(legenda = 'x', nFotos = 2): NovoLocal {
  const rascunho = criarRascunho({
    obraId: OBRA,
    ambienteId: AMB,
    tipo: 'pendencia',
    legenda,
    capturadoEm: new Date().toISOString(),
    fotos: Array.from({ length: nFotos }, () => ({
      id: crypto.randomUUID(),
      blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
      largura: 10,
      altura: 8,
      bytes: 4,
    })),
  })
  return { rascunho, obra: { slug: 'hto', nome: 'HTO' }, ambiente: { codigo: 'apto-101', nome: 'Apto. 101' } }
}

const PENDENCIA = '00000000-0000-4000-8000-000000000101'

function novoEncerramento(observacao = 'Refeito', nFotos = 2): NovoEncerramentoLocal {
  const rascunho = criarRascunhoEncerramento({
    registroId: PENDENCIA,
    obraId: OBRA,
    observacao,
    fotos: Array.from({ length: nFotos }, () => ({
      id: crypto.randomUUID(),
      blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
      largura: 10,
      altura: 8,
      bytes: 4,
    })),
  })
  return {
    rascunho,
    obra: { slug: 'hto', nome: 'HTO' },
    ambiente: { id: AMB, codigo: 'apto-101', nome: 'Apto. 101' },
    legenda: 'Tomada sem espelho',
  }
}

const drenar = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0)
}

let parar: (() => void)[] = []

function montar(
  repo: Repositorio,
  armazenamento: Armazenamento,
  extra: {
    usuarioId?: string
    aoEnviar?: (r: RegistroLocal) => Promise<void>
    aoEncerrar?: (e: EncerramentoLocal) => Promise<void>
    aoObservar?: (o: ObservacaoLocal) => Promise<void>
  } = {},
): Fila {
  const fila = criarFila({
    repo,
    armazenamento,
    usuarioId: extra.usuarioId ?? 'u1',
    aoEnviar: extra.aoEnviar,
    aoEncerrar: extra.aoEncerrar,
    aoObservar: extra.aoObservar,
  })
  parar.push(fila.iniciar())
  return fila
}

describe('fila de envio', () => {
  beforeEach(() => {
    // Só os temporizadores: o fake-indexeddb e o Date seguem reais.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    parar.forEach((p) => p())
    parar = []
    vi.useRealTimers()
  })

  it('grava no armazenamento antes de resolver e depois envia', async () => {
    const { repo, registros } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    expect(fila.obterEstado().carregada).toBe(true)

    const n = novo('primeiro')
    await fila.adicionar(n)
    // Resolveu: o registro já está guardado e na fila, com a metadados esperados.
    expect((await a.listar('u1')).map((r) => r.id)).toEqual([n.rascunho.id])
    expect(registros.size).toBe(0)
    await drenar()
    expect(registros.get(n.rascunho.id)).toBe(1)
    expect(await a.listar('u1')).toEqual([])
    expect(fila.obterEstado().itens).toEqual([])
  })

  it('monta o RegistroLocal e o expõe como aguardando enquanto a rede falha', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const n = novo('sem sinal', 3)
    await fila.adicionar(n)
    await drenar()
    const [item] = fila.obterEstado().itens
    expect(item.estado).toBe('aguardando')
    expect(item.registro).toMatchObject({
      id: n.rascunho.id,
      usuarioId: 'u1',
      obra: { id: OBRA, slug: 'hto', nome: 'HTO' },
      ambiente: { id: AMB, codigo: 'apto-101', nome: 'Apto. 101' },
      tipo: 'pendencia',
      legenda: 'sem sinal',
      erro: null,
    })
    expect(item.registro.fotos.map((f) => f.id)).toEqual(n.rascunho.fotos.map((f) => f.id))
    expect(fila.obterEstado().semConexao).toBe(true)
    const guardado = (await a.listar('u1'))[0]
    expect(guardado.id).toBe(n.rascunho.id)
    expect(await a.lerFoto(n.rascunho.id, n.rascunho.fotos[2].id)).toBeDefined()
  })

  it('sucesso: chama aoEnviar antes de tirar o item e erro em aoEnviar não quebra a fila', async () => {
    const { repo } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const vistos: number[] = []
    const fila: Fila = montar(repo, a, {
      aoEnviar: async () => {
        vistos.push(fila.obterEstado().itens.length)
        throw new Error('falha ao invalidar')
      },
    })
    await drenar()
    await fila.adicionar(novo('a'))
    await fila.adicionar(novo('b'))
    await drenar()
    expect(vistos).toEqual([2, 1])
    expect(fila.obterEstado().itens).toEqual([])
  })

  it('obterEstado devolve a mesma referência até haver mudança', async () => {
    const { repo } = criarRepoFalso()
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    const e1 = fila.obterEstado()
    expect(fila.obterEstado()).toBe(e1)
    const aviso = vi.fn()
    const cancelar = fila.assinar(aviso)
    await fila.adicionar(novo())
    expect(aviso).toHaveBeenCalled()
    expect(fila.obterEstado()).not.toBe(e1)
    cancelar()
    await drenar()
  })

  it('itens em ordem decrescente no estado e envio em ordem crescente', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    const a = novo('a')
    const b = novo('b')
    const c = novo('c')
    for (const n of [a, b, c]) {
      await fila.adicionar(n)
      await vi.advanceTimersByTimeAsync(5) // criadoEm distintos
    }
    await drenar()
    expect(fila.obterEstado().itens.map((i) => i.registro.id)).toEqual(
      [c, b, a].map((n) => n.rascunho.id),
    )
    estado.tentativas.length = 0
    estado.rede = true
    window.dispatchEvent(new Event('online'))
    await drenar()
    expect([...new Set(estado.tentativas)]).toEqual([a, b, c].map((n) => n.rascunho.id))
  })

  it('progresso vem do envio', async () => {
    const { repo } = criarRepoFalso()
    const original = repo.enviarFoto
    let liberar!: () => void
    const trava = new Promise<void>((r) => (liberar = r))
    repo.enviarFoto = async (c, b) => {
      await trava
      return original(c, b)
    }
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    await fila.adicionar(novo('p', 2))
    await drenar()
    const [item] = fila.obterEstado().itens
    expect(item.estado).toBe('enviando')
    expect(item.progresso).toEqual({ enviadas: 0, total: 2 })
    expect(fila.obterEstado().sincronizando).toBe(true)
    liberar()
    await drenar()
    expect(fila.obterEstado().itens).toEqual([])
    expect(fila.obterEstado().sincronizando).toBe(false)
  })

  it('falha de rede para a rodada, agenda o backoff (15, 30, 60, 120, 300) e online dispara na hora', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const armaz = criarArmazenamentoMemoria()
    const a = novo('a')
    const b = novo('b')
    // Dois itens já guardados: a primeira rodada vê os dois de uma vez.
    for (const [i, n] of [a, b].entries()) {
      await armaz.salvar(
        {
          id: n.rascunho.id,
          usuarioId: 'u1',
          obra: { id: OBRA, slug: 'hto', nome: 'HTO' },
          ambiente: { id: AMB, codigo: 'apto-101', nome: 'Apto. 101' },
          tipo: 'pendencia',
          legenda: n.rascunho.legenda,
          capturadoEm: n.rascunho.capturadoEm,
          criadoEm: new Date(2026, 10, 9, 10, i).toISOString(),
          fotos: n.rascunho.fotos.map(({ id, largura, altura, bytes }) => ({ id, largura, altura, bytes })),
          erro: null,
        },
        n.rascunho.fotos.map((f) => ({ id: f.id, dados: new ArrayBuffer(4) })),
      )
    }
    const fila = montar(repo, armaz)
    await drenar()
    // A rodada para no primeiro item: o segundo nunca é tentado enquanto a rede falha.
    const tentativasA = () => estado.tentativas.filter((i) => i === a.rascunho.id).length
    const tentativasB = () => estado.tentativas.filter((i) => i === b.rascunho.id).length
    expect(tentativasB()).toBe(0)
    const base = estado.tentativas.length

    const esperas = [15_000, 30_000, 60_000, 120_000, 300_000, 300_000]
    let anterior = base
    for (const espera of esperas) {
      await vi.advanceTimersByTimeAsync(espera - 1)
      expect(estado.tentativas.length).toBe(anterior)
      await vi.advanceTimersByTimeAsync(1)
      await drenar()
      expect(estado.tentativas.length).toBeGreaterThan(anterior)
      anterior = estado.tentativas.length
    }
    expect(tentativasA()).toBeGreaterThan(1)
    expect(tentativasB()).toBe(0)

    // O evento online dispara na hora e zera o atraso.
    estado.rede = true
    window.dispatchEvent(new Event('online'))
    await drenar()
    expect(fila.obterEstado().itens).toEqual([])
    expect(fila.obterEstado().semConexao).toBe(false)
  })

  it('depois de um sucesso o backoff volta a 15 s', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    await fila.adicionar(novo('a'))
    await drenar()
    await vi.advanceTimersByTimeAsync(15_000) // 2ª falha, próxima em 30 s
    await drenar()
    estado.rede = true
    await vi.advanceTimersByTimeAsync(30_000)
    await drenar()
    expect(fila.obterEstado().itens).toEqual([])
    estado.rede = false
    await fila.adicionar(novo('b'))
    await drenar()
    const antes = estado.tentativas.length
    await vi.advanceTimersByTimeAsync(15_000)
    await drenar()
    expect(estado.tentativas.length).toBeGreaterThan(antes)
  })

  it('falha definitiva grava erro, segue para o próximo e só volta com tentarDeNovo', async () => {
    const { repo, estado, registros } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const ruim = novo('ruim')
    const bom = novo('bom')
    estado.definitivas.add(ruim.rascunho.id)
    estado.rede = false
    await fila.adicionar(ruim)
    await fila.adicionar(bom)
    await drenar()
    estado.rede = true
    window.dispatchEvent(new Event('online'))
    await drenar()

    const itens = fila.obterEstado().itens
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ estado: 'erro' })
    expect(itens[0].registro.erro).toEqual({ tipo: 'validacao', mensagem: 'Legenda inválida' })
    expect(registros.has(bom.rascunho.id)).toBe(true)
    expect((await a.listar('u1'))[0].erro).toEqual({ tipo: 'validacao', mensagem: 'Legenda inválida' })

    // Sem nova tentativa automática.
    const antes = estado.tentativas.length
    await vi.advanceTimersByTimeAsync(600_000)
    window.dispatchEvent(new Event('online'))
    await drenar()
    expect(estado.tentativas.length).toBe(antes)

    // Corrigido no servidor, "Tentar de novo" envia.
    estado.definitivas.clear()
    await fila.tentarDeNovo(ruim.rascunho.id)
    await drenar()
    expect(registros.has(ruim.rascunho.id)).toBe(true)
    expect(fila.obterEstado().itens).toEqual([])
  })

  it('o erro definitivo volta como item de erro ao recarregar a fila', async () => {
    const { repo, estado } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const n = novo('ruim')
    estado.definitivas.add(n.rascunho.id)
    await fila.adicionar(n)
    await drenar()
    parar.forEach((p) => p())
    parar = []
    const fila2 = montar(repo, a)
    await drenar()
    expect(fila2.obterEstado().itens[0]).toMatchObject({ estado: 'erro' })
  })

  it('erro desconhecido é transitório mas a rodada segue para o próximo', async () => {
    const { repo, estado, registros } = criarRepoFalso()
    const original = repo.concluirRegistro
    const ruim = novo('ruim')
    repo.concluirRegistro = async (d) => {
      if (d.id === ruim.rascunho.id) throw new ErroEnvio('desconhecido', 'estranho')
      return original(d)
    }
    estado.rede = false
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    await fila.adicionar(ruim)
    const bom = novo('bom')
    await fila.adicionar(bom)
    await drenar()
    estado.rede = true
    window.dispatchEvent(new Event('online'))
    await drenar()
    expect(registros.has(bom.rascunho.id)).toBe(true)
    const [item] = fila.obterEstado().itens
    expect(item).toMatchObject({ estado: 'aguardando' })
    expect(item.registro.id).toBe(ruim.rascunho.id)
    // E é tentado de novo sozinho.
    const antes = estado.tentativas.length
    await vi.advanceTimersByTimeAsync(300_000)
    await drenar()
    expect(estado.tentativas.length).toBeGreaterThan(antes)
  })

  it('voo único: chamadas simultâneas não duplicam e repetem ao terminar', async () => {
    const { repo, registros, fotosEnviadas } = criarRepoFalso()
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    const n = novo('um', 1)
    await fila.adicionar(n)
    await Promise.all([fila.sincronizar(), fila.sincronizar(), fila.sincronizar()])
    await drenar()
    expect(registros.get(n.rascunho.id)).toBe(1)
    expect(fotosEnviadas).toHaveLength(1)
  })

  it('uma chamada durante o envio pega o item adicionado nesse meio-tempo', async () => {
    const { repo, registros } = criarRepoFalso()
    const original = repo.enviarFoto
    let liberar!: () => void
    let primeira = true
    const trava = new Promise<void>((r) => (liberar = r))
    repo.enviarFoto = async (c, b) => {
      if (primeira) {
        primeira = false
        await trava
      }
      return original(c, b)
    }
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    const a = novo('a', 1)
    const b = novo('b', 1)
    await fila.adicionar(a)
    await drenar()
    await fila.adicionar(b) // sincronizar em voo: marca para repetir
    liberar()
    await drenar()
    expect(registros.get(a.rascunho.id)).toBe(1)
    expect(registros.get(b.rascunho.id)).toBe(1)
  })

  it('isola por usuário: só lista e envia os itens do usuário atual', async () => {
    const { repo, registros } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const outroUsuario: RegistroLocal = {
      id: crypto.randomUUID(),
      usuarioId: 'u2',
      obra: { id: OBRA, slug: 'hto', nome: 'HTO' },
      ambiente: { id: AMB, codigo: 'x', nome: 'X' },
      tipo: 'servico',
      legenda: 'alheio',
      capturadoEm: new Date().toISOString(),
      criadoEm: new Date().toISOString(),
      fotos: [],
      erro: null,
    }
    await a.salvar(outroUsuario, [])
    const fila = montar(repo, a, { usuarioId: 'u1' })
    await drenar()
    expect(fila.obterEstado().itens).toEqual([])
    await fila.sincronizar()
    expect(registros.size).toBe(0)
    expect(await a.listar('u2')).toHaveLength(1)
  })

  it('uma fila nova sobre o mesmo armazenamento retoma sem duplicar (IndexedDB)', async () => {
    const { repo, registros, estado } = criarRepoFalso()
    const a1 = await abrirArmazenamento()
    estado.rede = false
    const fila1 = montar(repo, a1)
    await drenar()
    const n = novo('retomar', 2)
    await fila1.adicionar(n)
    await drenar()
    parar.forEach((p) => p())
    parar = []
    a1.fechar()

    estado.rede = true
    const a2 = await abrirArmazenamento()
    const fila2 = montar(repo, a2)
    await drenar()
    await vi.waitFor(() => expect(registros.get(n.rascunho.id)).toBe(1), { timeout: 2000, interval: 5 })
    expect(registros.get(n.rascunho.id)).toBe(1)
    expect(await a2.listar('u1')).toEqual([])
    expect(fila2.obterEstado().itens).toEqual([])
    a2.fechar()
  })

  it('perder a resposta da RPC não duplica o registro', async () => {
    const { repo, registros, estado } = criarRepoFalso()
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    const n = novo('resposta perdida', 1)
    estado.perderRespostaDe.add(n.rascunho.id)
    await fila.adicionar(n)
    await drenar()
    expect(fila.obterEstado().itens).toHaveLength(1) // o app acha que não enviou
    await vi.advanceTimersByTimeAsync(15_000)
    await drenar()
    expect(registros.get(n.rascunho.id)).toBe(2) // a RPC foi chamada duas vezes
    expect(registros.size).toBe(1) // mas é um registro só (idempotente por id)
    expect(fila.obterEstado().itens).toEqual([])
  })

  it('descartar remove o item e as fotos; ignora item enviando', async () => {
    const { repo, estado } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    estado.rede = false
    const fila = montar(repo, a)
    await drenar()
    const n = novo('descartar', 1)
    await fila.adicionar(n)
    await drenar()
    await fila.descartar(n.rascunho.id)
    expect(fila.obterEstado().itens).toEqual([])
    expect(await a.listar('u1')).toEqual([])
    expect(await a.lerFoto(n.rascunho.id, n.rascunho.fotos[0].id)).toBeUndefined()

    // Item enviando: ignorado.
    estado.rede = true
    const original = repo.enviarFoto
    let liberar!: () => void
    const trava = new Promise<void>((r) => (liberar = r))
    repo.enviarFoto = async (c, b) => {
      await trava
      return original(c, b)
    }
    const m = novo('enviando', 1)
    await fila.adicionar(m)
    await drenar()
    expect(fila.obterEstado().itens[0].estado).toBe('enviando')
    await fila.descartar(m.rascunho.id)
    expect(fila.obterEstado().itens).toHaveLength(1)
    liberar()
    await drenar()
    expect(fila.obterEstado().itens).toEqual([])
  })

  it('visibilitychange para visible dispara a sincronização', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    await fila.adicionar(novo('v'))
    await drenar()
    estado.rede = true
    document.dispatchEvent(new Event('visibilitychange'))
    await drenar()
    expect(fila.obterEstado().itens).toEqual([])
  })

  it('depois de parar, nada mais roda', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const fila = montar(repo, criarArmazenamentoMemoria())
    await drenar()
    await fila.adicionar(novo('p'))
    await drenar()
    parar.forEach((p) => p())
    parar = []
    const antes = estado.tentativas.length
    estado.rede = true
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(600_000)
    await drenar()
    expect(estado.tentativas.length).toBe(antes)
  })
})


describe('fila de envio: encerramento de pendência', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    parar.forEach((p) => p())
    parar = []
    vi.useRealTimers()
  })

  it('sucesso: grava no aparelho, sobe as fotos na pasta da pendência, encerra e chama aoEncerrar', async () => {
    const { repo, encerramentos, fotosEnviadas } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const avisados: string[] = []
    const fila = montar(repo, a, { aoEncerrar: async (e) => void avisados.push(e.pendenciaId) })
    await drenar()

    const n = novoEncerramento('Refeito e limpo')
    await fila.adicionarEncerramento(n)
    expect((await a.listarEncerramentos('u1')).map((e) => e.id)).toEqual([n.rascunho.id])
    expect(await a.lerFoto(n.rascunho.id, n.rascunho.fotos[0].id)).toBeDefined()
    expect(fila.obterEstado().encerramentos).toHaveLength(1)
    expect(fila.obterEstado().itens).toEqual([])

    await drenar()
    expect(encerramentos.get(n.rascunho.id)).toBe(1)
    // As fotos usam o id da pendência (e não o do encerramento) no caminho.
    expect(fotosEnviadas).toEqual(n.rascunho.fotos.map((f) => `${PENDENCIA}/${f.id}`))
    expect(avisados).toEqual([PENDENCIA])
    expect(await a.listarEncerramentos('u1')).toEqual([])
    expect(await a.lerFoto(n.rascunho.id, n.rascunho.fotos[0].id)).toBeUndefined()
    expect(fila.obterEstado().encerramentos).toEqual([])
  })

  it('falha transitória: volta a aguardar, repete depois e não duplica o encerramento', async () => {
    const { repo, estado, encerramentos } = criarRepoFalso()
    estado.rede = false
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const n = novoEncerramento()
    await fila.adicionarEncerramento(n)
    await drenar()
    const [item] = fila.obterEstado().encerramentos
    expect(item.estado).toBe('aguardando')
    expect(item.encerramento.erro).toBeNull()
    expect(fila.obterEstado().semConexao).toBe(true)

    estado.rede = true
    await vi.advanceTimersByTimeAsync(15_000)
    await drenar()
    expect(encerramentos.get(n.rascunho.id)).toBe(1)
    expect(fila.obterEstado().encerramentos).toEqual([])
    expect(fila.obterEstado().semConexao).toBe(false)
  })

  it('conflito (já encerrada) é definitivo: fica com erro, não tenta sozinho e tentarDeNovo limpa o erro', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.jaEncerradas.add(PENDENCIA)
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const n = novoEncerramento()
    await fila.adicionarEncerramento(n)
    await drenar()
    const [item] = fila.obterEstado().encerramentos
    expect(item.estado).toBe('erro')
    expect(item.encerramento.erro).toEqual({
      tipo: 'conflito',
      mensagem: 'Esta pendência já foi encerrada.',
    })
    expect((await a.listarEncerramentos('u1'))[0].erro?.tipo).toBe('conflito')

    const tentativas = estado.tentativasEncerramento.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(estado.tentativasEncerramento).toHaveLength(tentativas)

    await fila.tentarDeNovo(n.rascunho.id)
    await drenar()
    expect(estado.tentativasEncerramento.length).toBe(tentativas + 1)
    expect(fila.obterEstado().encerramentos[0].estado).toBe('erro')

    await fila.descartar(n.rascunho.id)
    expect(fila.obterEstado().encerramentos).toEqual([])
    expect(await a.listarEncerramentos('u1')).toEqual([])
  })

  it('registros e encerramentos saem na ordem de criação e a carga restaura o encerramento do aparelho', async () => {
    const { repo, estado, registros, encerramentos } = criarRepoFalso()
    estado.rede = false
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const reg = novo('antes')
    await fila.adicionar(reg)
    vi.setSystemTime(Date.now() + 1000)
    const enc = novoEncerramento()
    await fila.adicionarEncerramento(enc)
    await drenar()
    parar.forEach((p) => p())
    parar = []

    // Novo "app": a fila é recriada a partir do armazenamento.
    estado.rede = true
    const ordem: string[] = []
    const original = repo.concluirRegistro
    repo.concluirRegistro = async (d) => (ordem.push('registro'), original(d))
    const original2 = repo.encerrarPendencia
    repo.encerrarPendencia = async (d) => (ordem.push('encerramento'), original2(d))
    const fila2 = montar(repo, a)
    await drenar()
    expect(ordem).toEqual(['registro', 'encerramento'])
    expect(registros.get(reg.rascunho.id)).toBe(1)
    expect(encerramentos.get(enc.rascunho.id)).toBe(1)
    expect(fila2.obterEstado().itens).toEqual([])
    expect(fila2.obterEstado().encerramentos).toEqual([])
  })

  it('isola o encerramento por usuário', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const a = criarArmazenamentoMemoria()
    const fila1 = montar(repo, a, { usuarioId: 'u1' })
    await drenar()
    await fila1.adicionarEncerramento(novoEncerramento())
    const fila2 = montar(repo, a, { usuarioId: 'u2' })
    await drenar()
    expect(fila2.obterEstado().encerramentos).toEqual([])
    expect(fila1.obterEstado().encerramentos).toHaveLength(1)
  })
})

describe('fila de envio: observação do dia', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    parar.forEach((p) => p())
    parar = []
    vi.useRealTimers()
  })

  it('sucesso: grava no aparelho antes de enviar, envia com o mesmo id e chama aoObservar', async () => {
    const { repo, observacoes, estado } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const avisadas: string[] = []
    const fila = montar(repo, a, { aoObservar: async (o) => void avisadas.push(o.id) })
    await drenar()

    const n = novaObservacao()
    estado.rede = false
    await fila.adicionarObservacao(n)
    const [salva] = await a.listarObservacoes('u1')
    expect(salva).toMatchObject({ id: n.id, usuarioId: 'u1', texto: n.texto, escritoEm: n.escritoEm, erro: null })
    expect(salva.obra).toEqual(n.obra)
    expect(fila.obterEstado().observacoes).toHaveLength(1)

    await drenar()
    expect(fila.obterEstado().observacoes[0].estado).toBe('aguardando')
    expect(fila.obterEstado().semConexao).toBe(true)

    estado.rede = true
    window.dispatchEvent(new Event('online'))
    await drenar()
    // Toda tentativa usa o id gerado no aparelho.
    expect(new Set(estado.tentativasObservacao)).toEqual(new Set([n.id]))
    expect(observacoes.get(n.id)).toBe(n.texto)
    expect(avisadas).toEqual([n.id])
    expect(await a.listarObservacoes('u1')).toEqual([])
    expect(fila.obterEstado().observacoes).toEqual([])
    expect(fila.obterEstado().semConexao).toBe(false)
  })

  it('dia já emitido (22023) é definitivo: guarda a mensagem do servidor e não tenta sozinho', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.diaEmitido = true
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const n = novaObservacao()
    await fila.adicionarObservacao(n)
    await drenar()
    const [item] = fila.obterEstado().observacoes
    expect(item.estado).toBe('erro')
    expect(item.observacao.erro).toEqual({
      tipo: 'validacao',
      mensagem: 'O boletim de 13/11/2026 já foi emitido; a correção é feita por retificação',
    })
    expect((await a.listarObservacoes('u1'))[0].erro?.tipo).toBe('validacao')

    const tentativas = estado.tentativasObservacao.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(estado.tentativasObservacao).toHaveLength(tentativas)

    // Recarregada do aparelho, volta como erro (sem nova tentativa).
    parar.forEach((p) => p())
    parar = []
    const fila2 = montar(repo, a)
    await drenar()
    expect(fila2.obterEstado().observacoes[0].estado).toBe('erro')
    expect(estado.tentativasObservacao).toHaveLength(tentativas)

    await fila2.descartar(n.id)
    expect(fila2.obterEstado().observacoes).toEqual([])
    expect(await a.listarObservacoes('u1')).toEqual([])
  })

  it('outro erro definitivo (permissão) volta a tentar só com tentarDeNovo', async () => {
    const { repo, estado, observacoes } = criarRepoFalso()
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    const n = novaObservacao()
    estado.semPermissao.add(n.id)
    await fila.adicionarObservacao(n)
    await drenar()
    expect(fila.obterEstado().observacoes[0].observacao.erro?.tipo).toBe('permissao')

    estado.semPermissao.clear()
    await fila.tentarDeNovo(n.id)
    await drenar()
    expect(observacoes.get(n.id)).toBe(n.texto)
    expect(fila.obterEstado().observacoes).toEqual([])
  })

  it('registros, encerramentos e observações saem na ordem de criação', async () => {
    const { repo, estado } = criarRepoFalso()
    estado.rede = false
    const a = criarArmazenamentoMemoria()
    const fila = montar(repo, a)
    await drenar()
    await fila.adicionarObservacao(novaObservacao('primeira'))
    vi.setSystemTime(Date.now() + 1000)
    await fila.adicionar(novo('depois'))
    vi.setSystemTime(Date.now() + 1000)
    await fila.adicionarEncerramento(novoEncerramento())
    vi.setSystemTime(Date.now() + 1000)
    await fila.adicionarObservacao(novaObservacao('última'))
    await drenar()
    parar.forEach((p) => p())
    parar = []

    estado.rede = true
    const ordem: string[] = []
    const r1 = repo.concluirRegistro
    repo.concluirRegistro = async (d) => (ordem.push('registro'), r1(d))
    const r2 = repo.encerrarPendencia
    repo.encerrarPendencia = async (d) => (ordem.push('encerramento'), r2(d))
    const r3 = repo.salvarObservacao
    repo.salvarObservacao = async (d) => (ordem.push(`observacao:${d.texto}`), r3(d))
    const fila2 = montar(repo, a)
    await drenar()
    expect(ordem).toEqual(['observacao:primeira', 'registro', 'encerramento', 'observacao:última'])
    expect(fila2.obterEstado().observacoes).toEqual([])
  })

  it('isola as observações por usuário e retoma do IndexedDB sem duplicar', async () => {
    const { repo, estado, observacoes } = criarRepoFalso()
    estado.rede = false
    const a = await abrirArmazenamento()
    const fila1 = montar(repo, a, { usuarioId: 'u1' })
    await drenar()
    const n = novaObservacao()
    await fila1.adicionarObservacao(n)
    const fila2 = montar(repo, a, { usuarioId: 'u2' })
    await drenar()
    expect(fila2.obterEstado().observacoes).toEqual([])
    parar.forEach((p) => p())
    parar = []

    estado.rede = true
    const fila3 = montar(repo, a, { usuarioId: 'u1' })
    await drenar()
    await vi.waitFor(() => expect(fila3.obterEstado().observacoes).toEqual([]), { timeout: 2000, interval: 5 })
    expect(observacoes.get(n.id)).toBe(n.texto)
    expect(await a.listarObservacoes('u1')).toEqual([])
    a.fechar()
  })
})
