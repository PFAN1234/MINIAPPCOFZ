import type { PapelObra } from '@modules/acessos/domain/tipos.ts'
import type { RegistrosRepositorio } from '@modules/fiscalizacao/application/ports/RegistrosRepositorio.port.ts'
import type {
  Encerramento,
  EstadoPublicacao,
  FiltroRegistros,
  FotoRegistro,
  NovoEncerramento,
  NovoRegistro,
  PendenciaDetalhe,
  PublicacaoProblema,
  RegistroLocalizado,
  RegistroResumo,
} from '@modules/fiscalizacao/domain/tipos.ts'
import type { Ambiente, ObraDaLista, Pavimento } from '@modules/obras/domain/tipos.ts'
import { ErroEnvio } from '../../../dados/erros.ts'
import { dentroDoPeriodo } from '../../../util/periodo.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_BLOB = 10 * 1024 * 1024

function falhaValidacao(msg: string): never {
  throw new ErroEnvio('validacao', msg)
}

function inteiroPositivo(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999_999_999
}

function porRecente(a: RegistroResumo, b: RegistroResumo): number {
  return b.recebido_em.localeCompare(a.recebido_em)
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(leitor.error ?? new Error('Falha ao ler a foto.'))
    leitor.readAsDataURL(blob)
  })
}

export type EncerramentoFixture = Encerramento & { registro_id: string }

export interface EstadoRegistrosFixture {
  registros: RegistroResumo[]
  encerramentos: EncerramentoFixture[]
  publicacoes: Record<string, EstadoPublicacao>
  blobs: Map<string, Blob>
  dataUrls: Map<string, string>
  urlsDosBlobs: Map<string, string>
}

export interface DepsRegistrosFixture {
  obras: ObraDaLista[]
  obraComDados: string
  pavimentos: Pavimento[]
  ambientes: Omit<Ambiente, 'pendencias_abertas'>[]
  registrosBase: RegistroResumo[]
  encerramentosBase: EncerramentoFixture[]
  publicacoesBase: Omit<PublicacaoProblema, 'estado'>[]
  nomesPorId: Record<string, string>
  autorFixture: string
  estado: EstadoRegistrosFixture
  papelUsuario: () => PapelObra
  exigirRede: () => void
  persistir: () => void
  temPersistencia: boolean
  urlLocalDaImagem: (path: string) => string
}

export function criarRegistrosFixture(
  deps: DepsRegistrosFixture,
): RegistrosRepositorio & { todos(): RegistroResumo[] } {
  const {
    obras,
    obraComDados,
    pavimentos,
    ambientes,
    registrosBase,
    encerramentosBase,
    publicacoesBase,
    nomesPorId,
    autorFixture,
    estado,
    papelUsuario,
    exigirRede,
    persistir,
    temPersistencia,
    urlLocalDaImagem,
  } = deps

  const todosEncerramentos = () => [...encerramentosBase, ...estado.encerramentos]
  const encerramentoDe = (registroId: string) =>
    todosEncerramentos().find((e) => e.registro_id === registroId)

  /** Registros com a situação e a publicação atuais (encerramentos e republicações aplicados). */
  function todos(): RegistroResumo[] {
    return [...registrosBase, ...estado.registros].map((x) => {
      const pub = publicacoesBase.find((p) => p.registro_id === x.id)
      const pavimento = pavimentos.find(
        (p) => p.codigo === ambientes.find((a) => a.id === x.ambiente.id)?.pavimento_codigo,
      )?.nome
      return {
        ...x,
        ambiente: { ...x.ambiente, pavimento },
        situacao: x.tipo === 'pendencia' && encerramentoDe(x.id) ? 'resolvida' : x.situacao,
        publicacao: pub ? (estado.publicacoes[String(pub.id)] ?? x.publicacao) : x.publicacao,
      }
    })
  }

  function vinculada(path: string): boolean {
    return (
      estado.registros.some((n) => n.fotos.some((f) => f.path === path)) ||
      estado.encerramentos.some((n) => n.fotos.some((f) => f.path === path))
    )
  }

  return {
    todos,

    async listarRegistros(filtro: FiltroRegistros) {
      let lista = todos()
        .filter(
          (x) =>
            (!filtro.obraId || x.obra.id === filtro.obraId) &&
            (!filtro.obraSlug || x.obra.slug === filtro.obraSlug) &&
            (!filtro.ambienteId || x.ambiente.id === filtro.ambienteId) &&
            (!filtro.ambienteCodigo || x.ambiente.codigo === filtro.ambienteCodigo) &&
            (!filtro.tipo || x.tipo === filtro.tipo) &&
            (!filtro.situacao || x.situacao === filtro.situacao) &&
            (!filtro.etapaId || obras.find((o) => o.id === x.obra.id)?.etapa.id === filtro.etapaId) &&
            (!filtro.autorId || x.autor === nomesPorId[filtro.autorId]) &&
            dentroDoPeriodo(x.capturado_em, filtro.de, filtro.ate),
        )
        .sort(porRecente)
      if (filtro.limite) lista = lista.slice(0, filtro.limite)
      return lista.map((x) => ({ ...x, fotos: x.fotos.map((f) => ({ ...f })) }))
    },

    async autoresRegistros() {
      const nomes = new Set(todos().map((x) => x.autor))
      return Object.entries(nomesPorId)
        .filter(([, nome]) => nomes.has(nome))
        .map(([id, nome]) => ({ id, nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    },

    async urlsImagens(paths, bucket = 'plantas') {
      return Object.fromEntries(
        paths.map((p) => {
          const blob = bucket === 'fotos' ? estado.blobs.get(p) : undefined
          if (!blob) return [p, urlLocalDaImagem(p)]
          let url = estado.urlsDosBlobs.get(p)
          if (!url) {
            url = URL.createObjectURL(blob)
            estado.urlsDosBlobs.set(p, url)
          }
          return [p, url]
        }),
      )
    },

    async enviarFoto({ obraId, registroId, fotoId }, blob) {
      exigirRede()
      for (const [v, nome] of [
        [obraId, 'obra'],
        [registroId, 'registro'],
        [fotoId, 'foto'],
      ] as const) {
        if (!UUID.test(v)) falhaValidacao(`Identificador inválido (${nome}).`)
      }
      if (blob.type !== '' && blob.type !== 'image/jpeg') falhaValidacao('A foto deve ser JPEG.')
      if (blob.size > LIMITE_BLOB) falhaValidacao('A foto é grande demais para ser enviada.')
      const path = `${obraId}/${registroId}/${fotoId}.jpg`
      // Como a política fotos_update: foto já vinculada não pode ser sobrescrita.
      if (vinculada(path)) {
        throw new ErroEnvio('permissao', 'Sem permissão para enviar esta foto.')
      }
      const url = temPersistencia ? await blobParaDataUrl(blob) : null
      estado.blobs.set(path, blob)
      if (url) {
        estado.dataUrls.set(path, url)
        persistir()
      }
    },

    async obterPendencia(id): Promise<PendenciaDetalhe | null> {
      const registro = todos().find((x) => x.id === id && x.tipo === 'pendencia')
      if (!registro) return null
      const amb = ambientes.find((a) => a.id === registro.ambiente.id)!
      const pav = pavimentos.find((p) => p.codigo === amb.pavimento_codigo)!
      const enc = encerramentoDe(id)
      return {
        registro: { ...registro, fotos: registro.fotos.map((f) => ({ ...f })) },
        pavimento: { codigo: pav.codigo, nome: pav.nome },
        papel: papelUsuario(),
        encerramento: enc
          ? {
              id: enc.id,
              observacao: enc.observacao,
              encerrado_em: enc.encerrado_em,
              gestor: enc.gestor,
              fotos: enc.fotos.map((f) => ({ ...f })),
              publicacao: enc.publicacao,
            }
          : null,
      }
    },

    async encerrarPendencia(d: NovoEncerramento) {
      exigirRede()
      if (!UUID.test(d.id) || !UUID.test(d.registroId)) falhaValidacao('Identificadores obrigatórios')
      const registro = todos().find((x) => x.id === d.registroId && x.tipo === 'pendencia')
      if (!registro) throw new ErroEnvio('nao_encontrado', 'Pendência não encontrada.')
      // Qualquer participante da obra (equipe ou gestor) encerra; no fixture só a obra com dados tem participação.
      if (registro.obra.id !== obraComDados) throw new ErroEnvio('permissao', 'Você não participa desta obra.')

      const existente = todosEncerramentos().find((e) => e.id === d.id)
      if (existente) {
        if (existente.registro_id === d.registroId) return { id: existente.id }
        throw new ErroEnvio('conflito', 'encerramento_id em uso')
      }
      if (registro.situacao === 'resolvida') {
        throw new ErroEnvio('conflito', 'Esta pendência já foi encerrada.')
      }
      const observacao = (d.observacao ?? '').replace(/^\s+|\s+$/g, '')
      if (observacao.length > 1000) falhaValidacao('A observação deve ter até 1000 caracteres')
      if (!Array.isArray(d.fotos) || d.fotos.length < 1 || d.fotos.length > 10) {
        falhaValidacao('Envie de 1 a 10 fotos')
      }
      const vistos = new Set<string>()
      d.fotos.forEach((f, i) => {
        if (typeof f.id !== 'string' || !UUID.test(f.id)) {
          falhaValidacao(`Foto ${i + 1} com identificador inválido`)
        }
        const chave = f.id.toLowerCase()
        if (vistos.has(chave)) falhaValidacao('Identificador de foto repetido')
        vistos.add(chave)
        for (const campo of ['largura', 'altura', 'bytes'] as const) {
          if (!inteiroPositivo(f[campo])) {
            falhaValidacao(`Foto ${i + 1}: ${campo} deve ser um inteiro positivo`)
          }
        }
      })
      const fotos: FotoRegistro[] = d.fotos.map((f) => ({
        id: f.id,
        path: `${registro.obra.id}/${d.registroId}/${f.id}.jpg`,
        largura: f.largura,
        altura: f.altura,
      }))
      for (const f of fotos) {
        if (!estado.blobs.has(f.path)) {
          falhaValidacao(`Foto ${f.id} ainda não foi enviada ao armazenamento`)
        }
      }
      estado.encerramentos.push({
        id: d.id,
        registro_id: d.registroId,
        observacao: observacao || null,
        encerrado_em: new Date().toISOString(),
        gestor: autorFixture,
        fotos,
        publicacao: 'pendente',
      })
      persistir()
      return { id: d.id }
    },

    async localizarRegistro(id): Promise<RegistroLocalizado | null> {
      const reg = todos().find((x) => x.id === id)
      return reg ? { slug: reg.obra.slug, codigo: reg.ambiente.codigo, tipo: reg.tipo } : null
    },

    async concluirRegistro(d: NovoRegistro) {
      exigirRede()
      const amb = ambientes.find((a) => a.id === d.ambienteId)
      if (!UUID.test(d.id) || !d.ambienteId) falhaValidacao('Identificadores obrigatórios')
      if (!amb) throw new ErroEnvio('nao_encontrado', 'Ambiente não encontrado')

      const existente = estado.registros.find((n) => n.id === d.id)
      if (existente) {
        if (existente.ambiente.id === d.ambienteId) return { id: existente.id }
        throw new ErroEnvio('conflito', 'registro_id em uso')
      }

      if (d.tipo !== 'servico' && d.tipo !== 'pendencia') falhaValidacao('Tipo de registro inválido')
      const legenda = (d.legenda ?? '').replace(/^\s+|\s+$/g, '')
      if (legenda.length < 1 || legenda.length > 1000) {
        falhaValidacao('A legenda deve ter de 1 a 1000 caracteres')
      }
      const capturado = Date.parse(d.capturadoEm)
      if (Number.isNaN(capturado) || capturado > Date.now() + 5 * 60_000) {
        falhaValidacao('Data de captura inválida')
      }

      if (!Array.isArray(d.fotos) || d.fotos.length < 1 || d.fotos.length > 10) {
        falhaValidacao('Envie de 1 a 10 fotos')
      }
      const vistos = new Set<string>()
      d.fotos.forEach((f, i) => {
        if (typeof f.id !== 'string' || !UUID.test(f.id)) {
          falhaValidacao(`Foto ${i + 1} com identificador inválido`)
        }
        const chave = f.id.toLowerCase()
        if (vistos.has(chave)) falhaValidacao('Identificador de foto repetido')
        vistos.add(chave)
        for (const campo of ['largura', 'altura', 'bytes'] as const) {
          if (!inteiroPositivo(f[campo])) {
            falhaValidacao(`Foto ${i + 1}: ${campo} deve ser um inteiro positivo`)
          }
        }
      })
      const fotos: FotoRegistro[] = d.fotos.map((f) => ({
        id: f.id,
        path: `${obraComDados}/${d.id}/${f.id}.jpg`,
        largura: f.largura,
        altura: f.altura,
        ...(f.origem ? { origem: f.origem } : {}),
      }))
      for (const f of fotos) {
        if (!estado.blobs.has(f.path)) {
          falhaValidacao(`Foto ${f.id} ainda não foi enviada ao armazenamento`)
        }
      }

      const obraAlvo = obras.find((o) => o.id === obraComDados)!
      const agora = new Date().toISOString()
      estado.registros.push({
        id: d.id,
        tipo: d.tipo,
        situacao: d.tipo === 'pendencia' ? 'aberta' : null,
        legenda,
        autor: autorFixture,
        capturado_em: new Date(capturado).toISOString(),
        recebido_em: agora,
        ambiente: { id: amb.id, codigo: amb.codigo, nome: amb.nome_operacional },
        obra: { id: obraAlvo.id, slug: obraAlvo.slug, nome: obraAlvo.nome },
        fotos,
        publicacao: 'pendente',
      })
      persistir()
      return { id: d.id }
    },
  }
}
