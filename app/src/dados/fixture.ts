/**
 * Repositório de teste (VITE_DADOS=fixture). Usa os JSON reais da HTO e serve
 * as imagens por `/__plantas/` (plugin em `vite.config.ts`).
 * Nunca deve entrar no build de produção.
 */
import ambientesJson from '../../../data/hto/ambientes.json'
import plantasJson from '../../../data/hto/plantas.json'
import geometriaJson from '../../../data/hto/geometria.json'
import { ErroEnvio, MENSAGEM_REDE } from './erros.ts'
import { nomeMostrado } from './nome.ts'
import { dataNoFuso, formatarDia } from '../util/fuso.ts'
import { baixarModeloLocal, listarModelosLocais } from '../modelo/modelos.ts'
import type { Repositorio } from './repositorio.ts'
import type {
  Ambiente,
  AmbienteDetalhe,
  Encerramento,
  DetalhePlanta,
  EstadoPublicacao,
  FiltroRegistros,
  LinkAdmin,
  FotoRegistro,
  ImagemPlanta,
  NovaObservacao,
  NovoEncerramento,
  NovoRegistro,
  Etapa,
  Observacao,
  ObservacoesDoDia,
  ObraDaLista,
  ObraDetalhe,
  ObraDisponivel,
  ObraResumo,
  Organizacao,
  PapelObra,
  Participante,
  Pavimento,
  PendenciaDetalhe,
  Planta,
  PublicacaoProblema,
  RecortePt,
  RegistroLocalizado,
  RegistroResumo,
  SolicitacaoAcesso,
} from './tipos.ts'

const ID_HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const ID_AURORA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02'

const ID_DEMONSTRACAO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e03'
const ID_ALOJAMENTOS = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e04'
const ID_PEDIDO_MARIA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4f01'

/** Etapas da fixture: as obras atuais na 2ª, uma obra simples na 3ª (testes do seletor). */
export const ETAPA_2: Etapa = {
  id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02',
  slug: '2a-etapa',
  nome: '2ª ETAPA',
  ordem: 2,
}
export const ETAPA_3: Etapa = {
  id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b03',
  slug: '3a-etapa',
  nome: '3ª ETAPA',
  ordem: 3,
}

/** Como a linha padrão de `organizacao` no banco: "CO-FZ", sem logo. */
const NOME_ORGANIZACAO = 'CO-FZ'

/** Obra em que o usuário de teste está no grupo do Telegram, mas sem acesso. */
const OBRA_DEMONSTRACAO: ObraResumo = {
  id: ID_DEMONSTRACAO,
  slug: 'demonstracao',
  nome: 'Obra Demonstração',
}

const PEDIDO_MARIA: SolicitacaoAcesso = {
  id: ID_PEDIDO_MARIA,
  usuario_id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a01',
  nome: 'Maria Souza',
  username: 'maria',
  criado_em: '2026-11-09T18:30:00Z',
}

const ID_USUARIO = 'usuario-teste'
const ID_MARCOS = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a02'
const ID_JOAO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a03'
const ID_PATRICIO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a04'

/**
 * Pessoa com nome de exibição (definido pelo admin no site): o app mostra `CP PATRICIO`, e não o
 * nome do Telegram. As demais pessoas da fixture não têm nome de exibição e aparecem pelo do Telegram.
 */
const PATRICIO = { nome: 'Patricio Ferreira', nome_exibicao: 'CP PATRICIO' }
const NOME_PATRICIO = nomeMostrado(PATRICIO)!

const PARTICIPANTES_BASE: (Participante & { papel_inicial: PapelObra })[] = [
  { usuario_id: ID_USUARIO, nome: 'Você (teste)', username: 'voce', papel: 'gestor', papel_inicial: 'gestor', desde: '2026-10-20T12:00:00Z' },
  { usuario_id: ID_MARCOS, nome: 'Marcos Teixeira', username: 'marcos', papel: 'equipe', papel_inicial: 'equipe', desde: '2026-10-22T14:30:00Z' },
  { usuario_id: ID_JOAO, nome: 'João Lima', username: 'joao', papel: 'equipe', papel_inicial: 'equipe', desde: '2026-10-25T09:10:00Z' },
  { usuario_id: ID_PATRICIO, nome: NOME_PATRICIO, username: 'patricio', papel: 'equipe', papel_inicial: 'equipe', desde: '2026-10-26T11:00:00Z' },
]

const OBRAS: ObraDaLista[] = [
  { id: ID_HTO, slug: 'hto', nome: 'HTO', etapa: ETAPA_2 },
  { id: ID_AURORA, slug: 'aurora', nome: 'Residencial Aurora', etapa: ETAPA_2 },
  { id: ID_ALOJAMENTOS, slug: 'alojamentos', nome: 'Bloco de Alojamentos', etapa: ETAPA_3 },
]

interface DetalheJson {
  arquivo: string
  recorte_pt: number[]
  largura: number
  altura: number
}
interface ImagemJson {
  largura: number
  altura: number
}
interface PavimentoJson {
  id: string
  nome: string
  revisao: string
  pagina_pt: number[]
  recorte_pt: number[]
  imagens: { planta: ImagemJson; 'planta-hd': ImagemJson }
  detalhes: Record<string, DetalheJson>
}

function caminho(rev: string, pav: string, resto: string): string {
  return `${ID_HTO}/${rev}/${pav}/${resto}`
}

function imagem(path: string, i: ImagemJson): ImagemPlanta {
  return { path, largura: i.largura, altura: i.altura }
}

const pavsJson = plantasJson.pavimentos as unknown as PavimentoJson[]

const plantasPorPavimento = new Map<string, Planta>(
  pavsJson.map((p) => [
    p.id,
    {
      id: `planta-${p.id}-${p.revisao}`,
      revisao: p.revisao,
      pagina_pt: p.pagina_pt as [number, number],
      recorte_pt: p.recorte_pt as RecortePt,
      imagem: imagem(caminho(p.revisao, p.id, 'planta.webp'), p.imagens.planta),
      imagem_hd: imagem(caminho(p.revisao, p.id, 'planta-hd.webp'), p.imagens['planta-hd']),
    },
  ]),
)

const PAVIMENTOS: Pavimento[] = ambientesJson.pavimentos.map((p, i) => ({
  id: p.id,
  codigo: p.id,
  nome: p.nome,
  ordem: i,
  planta: plantasPorPavimento.get(p.id) ?? null,
}))

interface RemovidoJson {
  id: string
  pavimento: string
  nome_operacional: string
}

/** Como no banco: os ambientes que saíram da planta entram inativos, sem pino nem detalhe. */
const REMOVIDOS_JSON = (ambientesJson as unknown as { ambientes_removidos?: RemovidoJson[] })
  .ambientes_removidos ?? []

const AMBIENTES_BASE: Omit<Ambiente, 'pendencias_abertas'>[] = [
  ...ambientesJson.ambientes.map((a) => ({
    id: a.id,
    codigo: a.id,
    pavimento_codigo: a.pavimento,
    nome_operacional: a.nome_operacional,
    nome_planta: a.nome_planta as string | null,
    categoria: a.categoria,
    area_m2: a.area_m2 ?? null,
    marcadores: a.marcadores.map((m) => ({ x: m.x, y: m.y })),
    ativo: true,
  })),
  ...REMOVIDOS_JSON.map((r) => ({
    id: r.id,
    codigo: r.id,
    pavimento_codigo: r.pavimento,
    nome_operacional: r.nome_operacional,
    nome_planta: null,
    categoria: '',
    area_m2: null,
    marcadores: [],
    ativo: false,
  })),
]

function detalhePlanta(pav: string, codigo: string): DetalhePlanta | null {
  const p = pavsJson.find((x) => x.id === pav)
  const d = p?.detalhes[codigo]
  if (!p || !d) return null
  return {
    imagem: {
      path: caminho(p.revisao, pav, `ambientes/${codigo}.webp`),
      largura: d.largura,
      altura: d.altura,
    },
    recorte_pt: d.recorte_pt as RecortePt,
  }
}

function r(
  n: number,
  tipo: RegistroResumo['tipo'],
  situacao: RegistroResumo['situacao'],
  amb: string,
  autor: string,
  capturado: string,
  legenda: string,
  publicacao: EstadoPublicacao,
  nFotos = 1,
): RegistroResumo {
  const a = AMBIENTES_BASE.find((x) => x.codigo === amb)!
  const id = `00000000-0000-4000-8000-00000000010${n}`
  // Fotos de exemplo: recortes da planta, servidos por /__plantas/.
  const base = detalhePlanta(a.pavimento_codigo, a.codigo)?.imagem
  const pav = pavsJson.find((x) => x.id === a.pavimento_codigo)!
  const modelo = base ?? imagem(caminho(pav.revisao, pav.id, 'planta.webp'), pav.imagens.planta)
  const fotos: FotoRegistro[] = Array.from({ length: nFotos }, (_, k) => ({
    id: `00000000-0000-4000-8000-0000000002${n}${k}`,
    path: modelo.path,
    largura: modelo.largura,
    altura: modelo.altura,
  }))
  return {
    id,
    tipo,
    situacao,
    legenda,
    autor,
    capturado_em: capturado,
    recebido_em: new Date(Date.parse(capturado) + 90_000).toISOString(),
    ambiente: { id: a.id, codigo: a.codigo, nome: a.nome_operacional },
    obra: { id: ID_HTO, slug: 'hto', nome: 'HTO' },
    fotos,
    publicacao,
  }
}

/** Foto de exemplo (recorte da planta) para o encerramento da pendência `n`. */
function encerramentoBase(
  n: number,
  amb: string,
  gestor: string,
  encerradoEm: string,
  observacao: string | null,
  publicacao: EstadoPublicacao,
): Encerramento & { registro_id: string } {
  const a = AMBIENTES_BASE.find((x) => x.codigo === amb)!
  const pav = pavsJson.find((x) => x.id === a.pavimento_codigo)!
  const modelo =
    detalhePlanta(a.pavimento_codigo, a.codigo)?.imagem ??
    imagem(caminho(pav.revisao, pav.id, 'planta.webp'), pav.imagens.planta)
  return {
    id: `00000000-0000-4000-8000-00000000030${n}`,
    registro_id: `00000000-0000-4000-8000-00000000010${n}`,
    observacao,
    encerrado_em: encerradoEm,
    gestor,
    fotos: [
      {
        id: `00000000-0000-4000-8000-0000000004${n}0`,
        path: modelo.path,
        largura: modelo.largura,
        altura: modelo.altura,
      },
    ],
    publicacao,
  }
}

const ENCERRAMENTOS_BASE = [
  encerramentoBase(6, 'terreo-circulacao-sul', 'Juliana Prado', '2026-11-04T10:15:00Z', 'Rejunte refeito e piso limpo.', 'publicado'),
]

/** Publicações com problema da fixture: id da publicação -> registro. */
const PUBLICACOES_BASE: Omit<PublicacaoProblema, 'estado'>[] = [
  {
    id: 1,
    erro: 'Telegram respondeu 400: message thread not found',
    tentativas: 5,
    atualizado_em: '2026-11-05T09:40:00Z',
    registro_id: '00000000-0000-4000-8000-000000000105',
    encerramento_id: null,
    tipo: 'pendencia',
    legenda: 'Guarda-corpo com fixação folgada.',
    ambiente: 'Circulação',
  },
  {
    id: 2,
    erro: 'Tempo esgotado ao publicar; a mensagem pode ter sido enviada.',
    tentativas: 1,
    atualizado_em: '2026-11-07T14:20:00Z',
    registro_id: '00000000-0000-4000-8000-000000000104',
    encerramento_id: null,
    tipo: 'servico',
    legenda: 'Instalação do forro de gesso finalizada.',
    ambiente: 'Administração',
  },
]
const ESTADO_INICIAL_PUBLICACOES: Record<string, EstadoPublicacao> = { '1': 'falhou', '2': 'incerto' }

const REGISTROS: RegistroResumo[] = [
  r(1, 'pendencia', 'aberta', 'terreo-apto-101', 'Marcos Teixeira', '2026-11-09T13:20:00Z', 'Tomada da sala sem espelho; refazer o acabamento.', 'publicado', 2),
  r(2, 'servico', null, 'terreo-apto-101', 'Juliana Prado', '2026-11-06T17:05:00Z', 'Contrapiso do quarto concluído e curado.', 'publicado', 1),
  r(3, 'pendencia', 'aberta', 'terreo-apto-102', 'Marcos Teixeira', '2026-11-08T11:40:00Z', 'Mancha de infiltração na parede do banheiro.', 'pendente', 1),
  r(4, 'servico', null, 'terreo-administracao', 'Juliana Prado', '2026-11-07T14:10:00Z', 'Instalação do forro de gesso finalizada.', 'incerto', 3),
  r(5, 'pendencia', 'aberta', '1pav-circulacao', NOME_PATRICIO, '2026-11-05T09:30:00Z', 'Guarda-corpo com fixação folgada.', 'falhou', 1),
  r(6, 'pendencia', 'resolvida', 'terreo-circulacao-sul', NOME_PATRICIO, '2026-11-03T15:45:00Z', 'Rejunte irregular no piso, já refeito.', 'publicado', 1),
]

function porRecente(a: RegistroResumo, b: RegistroResumo): number {
  return b.recebido_em.localeCompare(a.recebido_em)
}

function contarAbertas(registros: RegistroResumo[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of registros) {
    if (x.tipo === 'pendencia' && x.situacao === 'aberta') {
      m.set(x.ambiente.id, (m.get(x.ambiente.id) ?? 0) + 1)
    }
  }
  return m
}

function ambientesComContagem(registros: RegistroResumo[]): Ambiente[] {
  const abertas = contarAbertas(registros)
  return AMBIENTES_BASE.map((a) => ({ ...a, pendencias_abertas: abertas.get(a.id) ?? 0 }))
}

function obraPorSlug(slug: string): ObraResumo {
  const obra = OBRAS.find((o) => o.slug === slug)
  if (!obra) throw new Error('Obra não encontrada.')
  return { id: obra.id, slug: obra.slug, nome: obra.nome }
}

/** `<obra_id>/<revisao>/<pavimento>/...` vira `/__plantas/<revisao>/<pavimento>/...`. */
export function urlLocalDaImagem(path: string): string {
  const [, ...resto] = path.split('/')
  return `/__plantas/${resto.join('/')}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_BLOB = 10 * 1024 * 1024
const AUTOR_FIXTURE = 'Você (teste)'

function falhaValidacao(msg: string): never {
  throw new ErroEnvio('validacao', msg)
}

function inteiroPositivo(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999_999_999
}

const CHAVE_SERVIDOR = 'fixture-servidor'

/** Fuso da 2ª etapa (a da HTO), como no banco. */
const FUSO_FIXTURE = 'America/Fortaleza'
const MENSAGEM_SO_AUTOR = 'Só o autor pode alterar a observação'

/** Observação guardada no "servidor" da fixture. */
interface ObservacaoSalva {
  id: string
  obraId: string
  autorId: string
  autorNome: string
  data: string
  texto: string
  escrito_em: string
  editado_em: string | null
}

/**
 * Duas observações de hoje na HTO (uma de CP PATRICIO, outra do usuário de teste), com horas
 * do próprio dia no fuso da etapa (Fortaleza, UTC−3), antes de agora sempre que possível.
 */
function observacoesBase(agora = Date.now()): ObservacaoSalva[] {
  const data = dataNoFuso(new Date(agora), FUSO_FIXTURE)
  const inicio = Date.parse(`${data}T00:00:00-03:00`)
  const hora = (atrasoMs: number, minimoMs: number) =>
    new Date(Math.max(inicio + minimoMs, agora - atrasoMs)).toISOString()
  return [
    {
      id: '00000000-0000-4000-8000-000000000501',
      obraId: ID_HTO,
      autorId: ID_PATRICIO,
      autorNome: NOME_PATRICIO,
      data,
      texto: 'Concretagem da laje do 1º pavimento liberada pela fiscalização.',
      escrito_em: hora(3 * 3_600_000, 60_000),
      editado_em: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000502',
      obraId: ID_HTO,
      autorId: ID_USUARIO,
      autorNome: AUTOR_FIXTURE,
      data,
      texto: 'Equipe de elétrica reduzida hoje; retomada prevista para amanhã.',
      escrito_em: hora(3_600_000, 120_000),
      editado_em: null,
    },
  ]
}

interface EstadoSalvo {
  registros: RegistroResumo[]
  /** caminho no bucket `fotos` -> data URL */
  fotos: Record<string, string>
  /** Pedidos de acesso do usuário de teste por obra. */
  pedidos: Record<string, 'pendente' | 'recusada'>
  /** Decisões do gestor sobre os pedidos de outras pessoas, por id do pedido. */
  decisoes: Record<string, 'aprovada' | 'recusada'>
  /** Encerramentos feitos pelo app (os da base não entram aqui). */
  encerramentos: (Encerramento & { registro_id: string })[]
  /** Papel dos participantes que o gestor mudou. */
  papeis: Record<string, PapelObra>
  /** Participantes removidos pelo gestor. */
  removidos: string[]
  /** Estado atual das publicações com problema, por id da publicação. */
  publicacoes: Record<string, EstadoPublicacao>
  /** Observações das obras (as de exemplo entram na primeira carga). */
  observacoes: ObservacaoSalva[]
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(leitor.error ?? new Error('Falha ao ler a foto.'))
    leitor.readAsDataURL(blob)
  })
}

function dataUrlParaBlob(url: string): Blob {
  const virgula = url.indexOf(',')
  const cabecalho = url.slice(5, virgula) // depois de "data:"
  const tipo = cabecalho.replace(/;base64$/, '') || 'image/jpeg'
  const binario = atob(url.slice(virgula + 1))
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: tipo })
}

function carregarEstado(persistencia: Storage | null): EstadoSalvo {
  try {
    const bruto = persistencia?.getItem(CHAVE_SERVIDOR)
    if (bruto) {
      const e = JSON.parse(bruto) as Partial<EstadoSalvo>
      return {
        registros: Array.isArray(e.registros) ? e.registros : [],
        fotos: e.fotos && typeof e.fotos === 'object' ? e.fotos : {},
        pedidos: e.pedidos && typeof e.pedidos === 'object' ? e.pedidos : {},
        decisoes: e.decisoes && typeof e.decisoes === 'object' ? e.decisoes : {},
        encerramentos: Array.isArray(e.encerramentos) ? e.encerramentos : [],
        papeis: e.papeis && typeof e.papeis === 'object' ? e.papeis : {},
        removidos: Array.isArray(e.removidos) ? e.removidos : [],
        publicacoes:
          e.publicacoes && typeof e.publicacoes === 'object'
            ? e.publicacoes
            : { ...ESTADO_INICIAL_PUBLICACOES },
        observacoes: Array.isArray(e.observacoes) ? e.observacoes : observacoesBase(),
      }
    }
  } catch {
    // Estado corrompido ou sem acesso: começa vazio.
  }
  return {
    registros: [],
    fotos: {},
    pedidos: {},
    decisoes: {},
    encerramentos: [],
    papeis: {},
    removidos: [],
    publicacoes: { ...ESTADO_INICIAL_PUBLICACOES },
    observacoes: observacoesBase(),
  }
}

export function criarRepositorioFixture(
  opcoes: {
    persistencia?: Storage | null
    /** O usuário de teste é admin do Mini App (mostra o botão Administração)? Padrão: não. */
    admin?: boolean
    /** URL do logo da organização. Padrão: sem logo, como no banco recém-migrado. */
    logo?: string | null
    /** O boletim de hoje da 2ª etapa já foi emitido (observações de hoje travadas)? Padrão: não. */
    boletimEmitido?: boolean
  } = {},
): Repositorio {
  const persistencia = opcoes.persistencia ?? null
  const salvo = carregarEstado(persistencia)
  const novos: RegistroResumo[] = salvo.registros
  /** Objetos "enviados ao Storage": caminho no bucket `fotos` -> blob. */
  const blobs = new Map<string, Blob>()
  /** Mesmo conteúdo de `blobs`, em data URL, para persistir. */
  const dataUrls = new Map<string, string>(Object.entries(salvo.fotos))
  for (const [path, url] of dataUrls) {
    try {
      blobs.set(path, dataUrlParaBlob(url))
    } catch {
      dataUrls.delete(path)
    }
  }
  const urlsDosBlobs = new Map<string, string>()
  const pedidos = salvo.pedidos
  const decisoes = salvo.decisoes
  const novosEncerramentos = salvo.encerramentos
  const papeis = salvo.papeis
  const removidos = salvo.removidos
  const publicacoes = salvo.publicacoes
  const observacoes = salvo.observacoes

  function persistir(): void {
    if (!persistencia) return
    try {
      const estado: EstadoSalvo = {
        registros: novos,
        fotos: Object.fromEntries(dataUrls),
        pedidos,
        decisoes,
        encerramentos: novosEncerramentos,
        papeis,
        removidos,
        publicacoes,
        observacoes,
      }
      persistencia.setItem(CHAVE_SERVIDOR, JSON.stringify(estado))
    } catch {
      // Sem espaço no localStorage: o "servidor" fica só na memória.
    }
  }

  function exigirRede(): void {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ErroEnvio('rede', MENSAGEM_REDE)
    }
  }
  const todosEncerramentos = () => [...ENCERRAMENTOS_BASE, ...novosEncerramentos]
  const encerramentoDe = (registroId: string) =>
    todosEncerramentos().find((e) => e.registro_id === registroId)
  /** Registros com a situação e a publicação atuais (encerramentos e republicações aplicados). */
  const todos = (): RegistroResumo[] =>
    [...REGISTROS, ...novos].map((x) => {
      const pub = PUBLICACOES_BASE.find((p) => p.registro_id === x.id)
      const pavimento = PAVIMENTOS.find(
        (p) => p.codigo === AMBIENTES_BASE.find((a) => a.id === x.ambiente.id)?.pavimento_codigo,
      )?.nome
      return {
        ...x,
        ambiente: { ...x.ambiente, pavimento },
        situacao: x.tipo === 'pendencia' && encerramentoDe(x.id) ? 'resolvida' : x.situacao,
        publicacao: pub ? (publicacoes[String(pub.id)] ?? x.publicacao) : x.publicacao,
      }
    })

  function vinculada(path: string): boolean {
    return (
      novos.some((n) => n.fotos.some((f) => f.path === path)) ||
      novosEncerramentos.some((n) => n.fotos.some((f) => f.path === path))
    )
  }

  function papelUsuario(): PapelObra {
    return papeis[ID_USUARIO] ?? 'gestor'
  }

  function exigirGestor(obraId: string): void {
    if (obraId !== ID_HTO || papelUsuario() !== 'gestor') {
      throw new ErroEnvio('permissao', 'Só gestores da obra podem fazer isto.')
    }
  }

  function participantesAtuais(): Participante[] {
    return PARTICIPANTES_BASE.filter((p) => !removidos.includes(p.usuario_id)).map(
      ({ papel_inicial, ...p }) => ({ ...p, papel: papeis[p.usuario_id] ?? papel_inicial }),
    )
  }

  function exigirOutroGestor(usuarioId: string): void {
    const outros = participantesAtuais().filter(
      (p) => p.papel === 'gestor' && p.usuario_id !== usuarioId,
    )
    if (outros.length === 0) {
      throw new ErroEnvio('validacao', 'A obra precisa de pelo menos um gestor.')
    }
  }

  const hoje = () => dataNoFuso(new Date(), FUSO_FIXTURE)
  /** Como `privado.boletim_emitido`: só o dia de hoje pode estar emitido na fixture. */
  const diaTravado = (data: string) => opcoes.boletimEmitido === true && data === hoje()

  function exigirDiaAberto(data: string): void {
    if (diaTravado(data)) {
      falhaValidacao(`O boletim de ${formatarDia(data)} já foi emitido; a correção é feita por retificação`)
    }
  }

  function exigirObra(obraId: string): void {
    if (!OBRAS.some((o) => o.id === obraId)) {
      throw new ErroEnvio('permissao', 'Sem permissão nesta obra')
    }
  }

  function observacaoPublica(o: ObservacaoSalva): Observacao {
    return {
      id: o.id,
      data: o.data,
      texto: o.texto,
      escrito_em: o.escrito_em,
      editado_em: o.editado_em,
      autor: { id: o.autorId, nome: o.autorNome },
      minha: o.autorId === ID_USUARIO,
      travada: diaTravado(o.data),
    }
  }

  function publicacaoProblema(id: number): PublicacaoProblema {
    const base = PUBLICACOES_BASE.find((p) => p.id === id)
    if (!base) throw new ErroEnvio('nao_encontrado', 'Publicação não encontrada.')
    const estado = publicacoes[String(id)] ?? 'falhou'
    return { ...base, estado }
  }

  return {
    listarModelos: listarModelosLocais,
    baixarModelo: baixarModeloLocal,
    async obterGeometria(obra, ambiente) {
      if (obra.slug !== geometriaJson.obra) return null
      const g = (geometriaJson.ambientes as Record<string, { contorno: number[][]; y_piso: number; y_teto: number }>)[
        ambiente.codigo
      ]
      if (!g) return null
      return {
        contorno: g.contorno.map(([x, z]) => [x, z]),
        yPiso: g.y_piso,
        yTeto: g.y_teto,
        // QR de teste só no Apto. 101: parede 1, a 1,20 m do canto, centro a 1,50 m.
        qr: ambiente.codigo === 'terreo-apto-101' ? { parede: 0, distancia_m: 1.2, altura_m: 1.5, lado_m: 0.18 } : null,
        referencial: { sigla: geometriaJson.referencial.sigla, coordenadas: geometriaJson.referencial.coordenadas },
        matrizes: {},
      }
    },
    async idUsuario() {
      return 'usuario-teste'
    },

    async souAdmin() {
      return opcoes.admin === true
    },

    async criarLinkAdmin(): Promise<LinkAdmin> {
      exigirRede()
      if (opcoes.admin !== true) {
        throw new ErroEnvio('permissao', 'Apenas admins do Mini App podem abrir a administração.')
      }
      const base = typeof location === 'undefined' ? 'http://localhost' : location.origin
      return {
        url: `${base}/admin/#entrar=fixture`,
        expira_em: new Date(Date.now() + 120_000).toISOString(),
      }
    },

    async listarObras() {
      return OBRAS.map((o) => ({ ...o, etapa: { ...o.etapa } }))
    },

    async organizacao(): Promise<Organizacao> {
      return { nome: NOME_ORGANIZACAO, logo_url: opcoes.logo || null }
    },

    async obterObra(slug): Promise<ObraDetalhe> {
      const obra = obraPorSlug(slug)
      if (obra.id !== ID_HTO) return { obra, papel: 'equipe', pavimentos: [], ambientes: [] }
      return { obra, papel: papelUsuario(), pavimentos: PAVIMENTOS, ambientes: ambientesComContagem(todos()) }
    },

    async obterAmbiente(slug, codigo): Promise<AmbienteDetalhe> {
      const obra = obraPorSlug(slug)
      const ambiente = ambientesComContagem(todos()).find((a) => a.codigo === codigo)
      if (obra.id !== ID_HTO || !ambiente) throw new Error('Ambiente não encontrado.')
      const pavimento = PAVIMENTOS.find((p) => p.codigo === ambiente.pavimento_codigo)!
      return {
        obra,
        ambiente,
        pavimento,
        planta: pavimento.planta,
        detalhe: detalhePlanta(pavimento.codigo, ambiente.codigo),
      }
    },

    async listarRegistros(filtro: FiltroRegistros) {
      let lista = todos()
        .filter(
          (x) =>
            (!filtro.obraId || x.obra.id === filtro.obraId) &&
            (!filtro.obraSlug || x.obra.slug === filtro.obraSlug) &&
            (!filtro.ambienteId || x.ambiente.id === filtro.ambienteId) &&
            (!filtro.ambienteCodigo || x.ambiente.codigo === filtro.ambienteCodigo) &&
            (!filtro.tipo || x.tipo === filtro.tipo) &&
            (!filtro.situacao || x.situacao === filtro.situacao),
        )
        .sort(porRecente)
      if (filtro.limite) lista = lista.slice(0, filtro.limite)
      return lista.map((x) => ({ ...x, fotos: x.fotos.map((f) => ({ ...f })) }))
    },

    async urlsImagens(paths, bucket = 'plantas') {
      return Object.fromEntries(
        paths.map((p) => {
          const blob = bucket === 'fotos' ? blobs.get(p) : undefined
          if (!blob) return [p, urlLocalDaImagem(p)]
          let url = urlsDosBlobs.get(p)
          if (!url) {
            url = URL.createObjectURL(blob)
            urlsDosBlobs.set(p, url)
          }
          return [p, url]
        }),
      )
    },

    async enviarFoto({ obraId, registroId, fotoId }, blob) {
      exigirRede()
      for (const [v, nome] of [[obraId, 'obra'], [registroId, 'registro'], [fotoId, 'foto']] as const) {
        if (!UUID.test(v)) falhaValidacao(`Identificador inválido (${nome}).`)
      }
      if (blob.type !== '' && blob.type !== 'image/jpeg') falhaValidacao('A foto deve ser JPEG.')
      if (blob.size > LIMITE_BLOB) falhaValidacao('A foto é grande demais para ser enviada.')
      const path = `${obraId}/${registroId}/${fotoId}.jpg`
      // Como a política fotos_update: foto já vinculada não pode ser sobrescrita.
      if (vinculada(path)) {
        throw new ErroEnvio('permissao', 'Sem permissão para enviar esta foto.')
      }
      const url = persistencia ? await blobParaDataUrl(blob) : null
      blobs.set(path, blob)
      if (url) {
        dataUrls.set(path, url)
        persistir()
      }
    },

    async obrasDisponiveis(): Promise<ObraDisponivel[]> {
      return [
        {
          ...OBRA_DEMONSTRACAO,
          solicitacao: pedidos[ID_DEMONSTRACAO] ?? null,
          etapa_id: ETAPA_2.id,
          etapa_nome: ETAPA_2.nome,
          etapa_ordem: ETAPA_2.ordem,
        },
      ]
    },

    async solicitarAcesso(obraId) {
      exigirRede()
      if (obraId !== ID_DEMONSTRACAO) {
        throw new ErroEnvio('permissao', 'Entre no grupo da obra no Telegram para pedir acesso.')
      }
      pedidos[obraId] = 'pendente'
      persistir()
    },

    async listarSolicitacoes(obraId) {
      if (obraId !== ID_HTO) {
        throw new ErroEnvio('permissao', 'Só gestores da obra veem os pedidos de acesso.')
      }
      return decisoes[ID_PEDIDO_MARIA] ? [] : [{ ...PEDIDO_MARIA }]
    },

    async decidirSolicitacao(id, aprovar) {
      exigirRede()
      if (id !== ID_PEDIDO_MARIA) throw new ErroEnvio('nao_encontrado', 'Pedido não encontrado.')
      const nova = aprovar ? 'aprovada' : 'recusada'
      const atual = decisoes[id]
      if (atual && atual !== nova) throw new ErroEnvio('conflito', 'Pedido já decidido.')
      decisoes[id] = nova
      persistir()
    },

    async obterPendencia(id): Promise<PendenciaDetalhe | null> {
      const registro = todos().find((x) => x.id === id && x.tipo === 'pendencia')
      if (!registro) return null
      const amb = AMBIENTES_BASE.find((a) => a.id === registro.ambiente.id)!
      const pav = PAVIMENTOS.find((p) => p.codigo === amb.pavimento_codigo)!
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
      // Qualquer participante da obra (equipe ou gestor) encerra; no fixture só a HTO tem participação.
      if (registro.obra.id !== ID_HTO) throw new ErroEnvio('permissao', 'Você não participa desta obra.')

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
        if (!blobs.has(f.path)) {
          falhaValidacao(`Foto ${f.id} ainda não foi enviada ao armazenamento`)
        }
      }
      novosEncerramentos.push({
        id: d.id,
        registro_id: d.registroId,
        observacao: observacao || null,
        encerrado_em: new Date().toISOString(),
        gestor: AUTOR_FIXTURE,
        fotos,
        publicacao: 'pendente',
      })
      persistir()
      return { id: d.id }
    },

    async listarParticipantes(obraId) {
      exigirGestor(obraId)
      return participantesAtuais().sort(
        (a, b) =>
          Number(b.papel === 'gestor') - Number(a.papel === 'gestor') ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      )
    },

    async definirPapel(obraId, usuarioId, papel) {
      exigirRede()
      exigirGestor(obraId)
      if (papel !== 'equipe' && papel !== 'gestor') falhaValidacao('Papel inválido')
      const atual = participantesAtuais().find((p) => p.usuario_id === usuarioId)
      if (!atual) throw new ErroEnvio('nao_encontrado', 'Participante não encontrado.')
      if (atual.papel === 'gestor' && papel === 'equipe') exigirOutroGestor(usuarioId)
      papeis[usuarioId] = papel
      persistir()
    },

    async removerParticipante(obraId, usuarioId) {
      exigirRede()
      exigirGestor(obraId)
      const atual = participantesAtuais().find((p) => p.usuario_id === usuarioId)
      if (!atual) throw new ErroEnvio('nao_encontrado', 'Participante não encontrado.')
      if (atual.papel === 'gestor') exigirOutroGestor(usuarioId)
      removidos.push(usuarioId)
      persistir()
    },

    async listarPublicacoesProblema(obraId) {
      exigirGestor(obraId)
      return PUBLICACOES_BASE.map((p) => publicacaoProblema(p.id))
        .filter((p) => p.estado === 'incerto' || p.estado === 'falhou')
        .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))
    },

    async republicar(id) {
      exigirRede()
      const p = publicacaoProblema(id)
      exigirGestor(ID_HTO)
      if (p.estado !== 'incerto' && p.estado !== 'falhou') {
        falhaValidacao('Só publicações incertas ou com falha podem ser reenviadas.')
      }
      publicacoes[String(id)] = 'pendente'
      persistir()
    },

    async marcarPublicada(id) {
      exigirRede()
      const p = publicacaoProblema(id)
      exigirGestor(ID_HTO)
      if (p.estado !== 'incerto' && p.estado !== 'falhou') {
        falhaValidacao('Só publicações incertas ou com falha podem ser marcadas como publicadas.')
      }
      publicacoes[String(id)] = 'publicado'
      persistir()
    },

    async localizarRegistro(id): Promise<RegistroLocalizado | null> {
      const reg = todos().find((x) => x.id === id)
      return reg ? { slug: reg.obra.slug, codigo: reg.ambiente.codigo, tipo: reg.tipo } : null
    },

    async observacoesDoDia(obraId): Promise<ObservacoesDoDia> {
      exigirObra(obraId)
      const data = hoje()
      return {
        data,
        fuso: FUSO_FIXTURE,
        travada: diaTravado(data),
        observacoes: observacoes
          .filter((o) => o.obraId === obraId && o.data === data)
          .sort((a, b) => a.escrito_em.localeCompare(b.escrito_em) || a.id.localeCompare(b.id))
          .map(observacaoPublica),
      }
    },

    async salvarObservacao(d: NovaObservacao) {
      exigirRede()
      if (typeof d.id !== 'string' || !UUID.test(d.id)) falhaValidacao('Identificador da observação inválido')
      const texto = String(d.texto ?? '').replace(/^\s+|\s+$/g, '')
      if (texto.length < 1 || texto.length > 1000) {
        falhaValidacao('A observação deve ter de 1 a 1000 caracteres')
      }
      const existente = observacoes.find((o) => o.id === d.id)
      if (!existente) {
        exigirObra(d.obraId)
        const escrito = Date.parse(d.escritoEm)
        if (Number.isNaN(escrito)) falhaValidacao('Data e hora da observação inválidas')
        if (escrito > Date.now() + 5 * 60_000) {
          falhaValidacao('A hora da observação está no futuro; confira o relógio do aparelho')
        }
        const data = dataNoFuso(new Date(escrito), FUSO_FIXTURE)
        exigirDiaAberto(data)
        const nova: ObservacaoSalva = {
          id: d.id,
          obraId: d.obraId,
          autorId: ID_USUARIO,
          autorNome: AUTOR_FIXTURE,
          data,
          texto,
          escrito_em: new Date(escrito).toISOString(),
          editado_em: null,
        }
        observacoes.push(nova)
        persistir()
        return observacaoPublica(nova)
      }
      if (existente.autorId !== ID_USUARIO) throw new ErroEnvio('permissao', MENSAGEM_SO_AUTOR)
      if (existente.texto === texto) return observacaoPublica(existente) // reenvio idempotente
      exigirDiaAberto(existente.data)
      existente.texto = texto
      existente.editado_em = new Date().toISOString()
      persistir()
      return observacaoPublica(existente)
    },

    async excluirObservacao(id) {
      exigirRede()
      const i = observacoes.findIndex((o) => o.id === id)
      if (i < 0) return
      if (observacoes[i].autorId !== ID_USUARIO) throw new ErroEnvio('permissao', MENSAGEM_SO_AUTOR)
      exigirDiaAberto(observacoes[i].data)
      observacoes.splice(i, 1)
      persistir()
    },

    async concluirRegistro(d: NovoRegistro) {
      exigirRede()
      const amb = AMBIENTES_BASE.find((a) => a.id === d.ambienteId)
      if (!UUID.test(d.id) || !d.ambienteId) falhaValidacao('Identificadores obrigatórios')
      if (!amb) throw new ErroEnvio('nao_encontrado', 'Ambiente não encontrado')

      const existente = novos.find((n) => n.id === d.id)
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
        path: `${ID_HTO}/${d.id}/${f.id}.jpg`,
        largura: f.largura,
        altura: f.altura,
        ...(f.origem ? { origem: f.origem } : {}),
      }))
      for (const f of fotos) {
        if (!blobs.has(f.path)) {
          falhaValidacao(`Foto ${f.id} ainda não foi enviada ao armazenamento`)
        }
      }

      const agora = new Date().toISOString()
      novos.push({
        id: d.id,
        tipo: d.tipo,
        situacao: d.tipo === 'pendencia' ? 'aberta' : null,
        legenda,
        autor: AUTOR_FIXTURE,
        capturado_em: new Date(capturado).toISOString(),
        recebido_em: agora,
        ambiente: { id: amb.id, codigo: amb.codigo, nome: amb.nome_operacional },
        obra: { id: ID_HTO, slug: 'hto', nome: 'HTO' },
        fotos,
        publicacao: 'pendente',
      })
      persistir()
      return { id: d.id }
    },
  }
}
