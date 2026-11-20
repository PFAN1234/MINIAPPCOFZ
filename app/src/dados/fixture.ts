/**
 * Repositório de teste (VITE_DADOS=fixture). Usa os JSON reais da HTO e serve
 * as imagens por `/__plantas/` (plugin em `vite.config.ts`).
 * Nunca deve entrar no build de produção.
 */
import ambientesJson from '../../../data/hto/ambientes.json'
import plantasJson from '../../../data/hto/plantas.json'
import { criarAcessosFixture, ID_PATRICIO, ID_USUARIO, NOME_PATRICIO } from '@modules/acessos/infra/AcessosFixtureAdapter.ts'
import { criarEquipeServicoFixture } from '@modules/acessos/infra/EquipeServicoFixtureAdapter.ts'
import { criarSessaoFixture } from '@modules/acessos/infra/SessaoFixtureAdapter.ts'
import { criarPublicacoesFixture } from '@modules/fiscalizacao/infra/PublicacoesFixtureAdapter.ts'
import { criarRegistrosFixture } from '@modules/fiscalizacao/infra/RegistrosFixtureAdapter.ts'
import { criarEtapasInicioFixture } from '@modules/obras/infra/EtapasInicioFixtureAdapter.ts'
import { criarObrasFixture } from '@modules/obras/infra/ObrasFixtureAdapter.ts'
import { criarOrganizacaoFixture } from '@modules/obras/infra/OrganizacaoFixtureAdapter.ts'
import { criarModelosFixture } from '@modules/modelos/infra/ModelosFixtureAdapter.ts'
import { criarRaFixture } from '@modules/ra/infra/RaFixtureAdapter.ts'
import { criarObservacoesFixture, type ObservacaoSalva } from '@modules/relatorios/infra/ObservacoesFixtureAdapter.ts'
import { criarRelatoriosFixture } from '@modules/relatorios/infra/RelatoriosFixtureAdapter.ts'
import { ErroEnvio, MENSAGEM_REDE } from './erros.ts'
import { dataNoFuso } from '../shared/kernel/fuso.ts'
import type { Repositorio } from './repositorio.ts'
import type { RecortePt } from '@shared/kernel/tipos.ts'
import type { Encerramento, EstadoPublicacao, FotoRegistro, PublicacaoProblema, RegistroResumo } from '@modules/fiscalizacao/domain/tipos.ts'
import type { Ambiente, DetalhePlanta, ImagemPlanta, Etapa, ObraDaLista, Pavimento, Planta } from '@modules/obras/domain/tipos.ts'
import type { PapelObra } from '@modules/acessos/domain/tipos.ts'

const ID_HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const ID_AURORA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02'

const ID_ALOJAMENTOS = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e04'

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

/** Etapa em que o usuário da fixture não participa (equipe de serviço só para leitura). */
export const ETAPA_4: Etapa = {
  id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b04',
  slug: '4a-etapa',
  nome: '4ª ETAPA',
  ordem: 4,
}


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

/** `<obra_id>/<revisao>/<pavimento>/...` vira `/__plantas/<revisao>/<pavimento>/...`. */
export function urlLocalDaImagem(path: string): string {
  const [, ...resto] = path.split('/')
  return `/__plantas/${resto.join('/')}`
}

const AUTOR_FIXTURE = 'Você (teste)'
const NOME_POR_ID: Record<string, string> = { [ID_USUARIO]: AUTOR_FIXTURE, [ID_PATRICIO]: NOME_PATRICIO }

const CHAVE_SERVIDOR = 'fixture-servidor'

/** Fuso da 2ª etapa (a da HTO), como no banco. */
const FUSO_FIXTURE = 'America/Fortaleza'

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

const ETAPAS_RELATORIO = [
  { id: ETAPA_2.id, slug: '2a-etapa', nome: ETAPA_2.nome, sigla: '2ª', horario: '18:00' },
  { id: ETAPA_3.id, slug: '3a-etapa', nome: ETAPA_3.nome, sigla: '3ª', horario: '17:30' },
]

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

  const acessos = criarAcessosFixture({
    admin: opcoes.admin === true,
    estado: { pedidos, decisoes, papeis, removidos },
    persistir,
    exigirRede,
    obras: OBRAS,
  })
  const { papelUsuario, exigirGestor } = acessos
  const sessao = criarSessaoFixture({ admin: opcoes.admin === true, idUsuario: ID_USUARIO, exigirRede })
  const equipe = criarEquipeServicoFixture({
    etapas: [ETAPA_2, ETAPA_3, ETAPA_4],
    etapaSemParticipacao: ETAPA_4.id,
    exigirRede,
  })

  const registros = criarRegistrosFixture({
    obras: OBRAS,
    obraComDados: ID_HTO,
    pavimentos: PAVIMENTOS,
    ambientes: AMBIENTES_BASE,
    registrosBase: REGISTROS,
    encerramentosBase: ENCERRAMENTOS_BASE,
    publicacoesBase: PUBLICACOES_BASE,
    nomesPorId: NOME_POR_ID,
    autorFixture: AUTOR_FIXTURE,
    estado: {
      registros: novos,
      encerramentos: novosEncerramentos,
      publicacoes,
      blobs,
      dataUrls,
      urlsDosBlobs,
    },
    papelUsuario,
    exigirRede,
    persistir,
    temPersistencia: persistencia !== null,
    urlLocalDaImagem,
  })
  const publicacoesRepo = criarPublicacoesFixture({
    publicacoesBase: PUBLICACOES_BASE,
    estado: publicacoes,
    obraComDados: ID_HTO,
    exigirGestor,
    exigirRede,
    persistir,
  })

  const obras = criarObrasFixture({
    obras: OBRAS,
    obraComDados: ID_HTO,
    pavimentos: PAVIMENTOS,
    ambientes: AMBIENTES_BASE,
    detalhePlanta,
    registros: registros.todos,
    papelUsuario,
  })
  const organizacao = criarOrganizacaoFixture(opcoes.logo)
  const etapasInicio = criarEtapasInicioFixture([ETAPA_2, ETAPA_3, ETAPA_4], ETAPA_4.id)

  const hoje = () => dataNoFuso(new Date(), FUSO_FIXTURE)
  const relatoriosRepo = criarRelatoriosFixture({
    admin: opcoes.admin === true,
    etapas: ETAPAS_RELATORIO,
    etapaPrincipalId: ETAPA_2.id,
    hoje,
    exigirRede,
  })
  const observacoesRepo = criarObservacoesFixture({
    observacoes,
    fuso: FUSO_FIXTURE,
    boletimEmitido: opcoes.boletimEmitido === true,
    idUsuario: ID_USUARIO,
    autorFixture: AUTOR_FIXTURE,
    obrasIds: OBRAS.map((o) => o.id),
    exigirRede,
    persistir,
  })

  const ra = criarRaFixture()
  const modelos = criarModelosFixture()

  return {
    listarModelos: modelos.listarModelos,
    baixarModelo: modelos.baixarModelo,
    obterGeometria: ra.obterGeometria,
    idUsuario: sessao.idUsuario,
    souAdmin: sessao.souAdmin,
    criarLinkAdmin: sessao.criarLinkAdmin,
    equipeServico: equipe.equipeServico,
    fazerCheckin: equipe.fazerCheckin,
    fazerCheckout: equipe.fazerCheckout,
    listarObras: obras.listarObras,
    resumoObras: obras.resumoObras,
    obterObra: obras.obterObra,
    obterAmbiente: obras.obterAmbiente,
    organizacao: organizacao.organizacao,
    etapasInicio: etapasInicio.etapasInicio,
    obrasDisponiveis: acessos.obrasDisponiveis,
    solicitarAcesso: acessos.solicitarAcesso,
    listarSolicitacoes: acessos.listarSolicitacoes,
    decidirSolicitacao: acessos.decidirSolicitacao,
    matrizAcessos: acessos.matrizAcessos,
    definirAcesso: acessos.definirAcesso,
    listarParticipantes: acessos.listarParticipantes,
    definirPapel: acessos.definirPapel,
    removerParticipante: acessos.removerParticipante,
    listarRegistros: registros.listarRegistros,
    autoresRegistros: registros.autoresRegistros,
    urlsImagens: registros.urlsImagens,
    enviarFoto: registros.enviarFoto,
    concluirRegistro: registros.concluirRegistro,
    obterPendencia: registros.obterPendencia,
    encerrarPendencia: registros.encerrarPendencia,
    localizarRegistro: registros.localizarRegistro,
    listarPublicacoesProblema: publicacoesRepo.listarPublicacoesProblema,
    republicar: publicacoesRepo.republicar,
    marcarPublicada: publicacoesRepo.marcarPublicada,
    relatorios: relatoriosRepo.relatorios,
    painelRelatorios: relatoriosRepo.painelRelatorios,
    exportarPendencias: relatoriosRepo.exportarPendencias,
    urlPdfBoletim: relatoriosRepo.urlPdfBoletim,
    emitirBoletim: relatoriosRepo.emitirBoletim,
    excluirBoletim: relatoriosRepo.excluirBoletim,
    observacoesDoDia: observacoesRepo.observacoesDoDia,
    salvarObservacao: observacoesRepo.salvarObservacao,
    excluirObservacao: observacoesRepo.excluirObservacao,
  }
}
