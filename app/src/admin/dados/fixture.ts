/**
 * Repositório de teste do site de administração (VITE_DADOS=fixture): HTO e COFZ com a
 * configuração real de `data/<slug>/obra.json`, na etapa "2ª ETAPA", mais a "3ª ETAPA" vazia e a
 * organização "CO-FZ" sem logo, tudo em memória. Reproduz as regras das RPCs (slug, pavimento com
 * ambientes, último admin, etapas). Nunca entra no build de produção.
 */
import { criarAcessosAdminFixture } from '@modules/acessos/infra/AcessosAdminFixtureAdapter.ts'
import { criarSessaoAdminFixture } from '@modules/acessos/infra/SessaoAdminFixtureAdapter.ts'
import { criarEtapasAdminFixture, type EtapaMemoria } from '@modules/obras/infra/EtapasAdminFixtureAdapter.ts'
import { criarObrasAdminFixture, type ObraMemoria } from '@modules/obras/infra/ObrasAdminFixtureAdapter.ts'
import { criarOrganizacaoAdminFixture } from '@modules/obras/infra/OrganizacaoAdminFixtureAdapter.ts'
import { criarModelosFixture } from '@modules/modelos/infra/ModelosFixtureAdapter.ts'
import { criarPlantasFixture, type AmbientesJson } from '@modules/plantas/infra/PlantasFixtureAdapter.ts'
import { criarRaFixture } from '@modules/ra/infra/RaFixtureAdapter.ts'
import ambientesCofz from '../../../../data/cofz/ambientes.json'
import obraCofz from '../../../../data/cofz/obra.json'
import ambientesHto from '../../../../data/hto/ambientes.json'
import obraHto from '../../../../data/hto/obra.json'
import { dataBr, hojeNoFuso, numeroBoletim } from '../formato.ts'
import { CAMPOS_VAZIOS, dataValida, somarDias } from './fixtureBoletim.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import type { ConfigObra } from '@modules/plantas/domain/tipos.ts'
import { ErroAdmin, type ErroCliente, type ResumoOrfaos, type BoletimDaLista, type BoletimDetalhe, type BoletimEmitido, type EdicaoBoletim, type SnapshotBoletim, type PedidoEmissao } from './tipos.ts'
import type { UsuarioApp } from '@modules/acessos/domain/tipos.ts'

interface ObraJson {
  slug: string
  nome: string
  pavimentos: { codigo: string; nome: string; ordem: number; pdf?: string; pagina?: number }[]
  [chave: string]: unknown
}

/** Grupo do Telegram da 2ª ETAPA na fixture. */
const GRUPO_2A = -1001234567890

/**
 * PDF mínimo (uma página A4 com uma linha de texto ASCII), para "Abrir PDF" e a prévia na fixture.
 */
export function pdfMinimo(texto: string): Uint8Array<ArrayBuffer> {
  const seguro = texto.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '')
  const conteudo = `BT /F1 18 Tf 72 760 Td (${seguro}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let corpo = '%PDF-1.4\n'
  const posicoes: number[] = []
  objetos.forEach((o, i) => {
    posicoes.push(corpo.length)
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = corpo.length
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const p of posicoes) corpo += `${String(p).padStart(10, '0')} 00000 n \n`
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(corpo) as Uint8Array<ArrayBuffer>
}

const VOCE: UsuarioApp = { id: 'usuario-teste', nome: 'Você (teste)', username: 'voce', telegram_id: 1, eh_admin: true }
const USUARIOS_BASE: Omit<UsuarioApp, 'eh_admin'>[] = [
  { id: VOCE.id, nome: VOCE.nome, username: VOCE.username, telegram_id: VOCE.telegram_id },
  { id: 'usuario-patricio', nome: 'Patrício Ferreira', username: null, telegram_id: 1362893349 },
  { id: 'usuario-eduardo', nome: 'Eduardo Lima', username: null, telegram_id: 669804829 },
  { id: 'usuario-maria', nome: 'Maria Souza', username: 'maria', telegram_id: 4242 },
]

function obraDoJson(
  id: string,
  ordem: number,
  json: ObraJson,
  ambientes: AmbientesJson,
  etapaId: string,
  chat: number | null,
): ObraMemoria {
  const { slug, nome, pavimentos, ...resto } = json
  return {
    id,
    slug,
    nome,
    ordem,
    pavimentos: pavimentos.map((p) => ({
      id: `${slug}-${p.codigo}`,
      codigo: p.codigo,
      nome: p.nome,
      ordem: p.ordem,
      ambientes: ambientes.ambientes.filter((a) => a.pavimento === p.codigo).length,
    })),
    config: {
      ...resto,
      pavimentos: pavimentos.map(({ codigo, pdf, pagina }) => ({ codigo, pdf, pagina })),
    } as ConfigObra,
    config_atualizada_em: '2026-11-11T12:00:00Z',
    config_atualizada_por: null,
    arquivada_em: null,
    etapa_id: etapaId,
    telegram_chat_id: chat,
  }
}

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Boletim da fixture: o emitido + o que `admin_boletim` e a lista geral acrescentam. */
type BoletimMemoria = BoletimEmitido & {
  etapa_id: string
  base_numero: string | null
  edicao: EdicaoBoletim | null
  rascunho: { edicao: EdicaoBoletim; atualizado_em: string; atualizado_por_nome: string | null } | null
  snapshot: SnapshotBoletim
}
type PedidoMemoria = PedidoEmissao & { etapa_id: string; edicao?: EdicaoBoletim }

const CAMPOS_EMITIDO: (keyof BoletimEmitido)[] = [
  'id', 'data', 'revisao', 'numero', 'emitido_em', 'emitido_por_nome', 'pdf_path', 'publicado',
  'publicacao_estado', 'publicacao_erro', 'publicacao_tentativas',
]
function emitidoDe(b: BoletimMemoria): BoletimEmitido {
  const r: Record<string, unknown> = {}
  for (const k of CAMPOS_EMITIDO) r[k] = b[k]
  return copia(r) as unknown as BoletimEmitido
}
function pedidoPublico(p: PedidoMemoria): PedidoEmissao {
  const r: Partial<PedidoMemoria> = copia(p)
  delete r.etapa_id
  delete r.edicao
  return r as PedidoEmissao
}

/** Edição sem nenhuma alteração (como `privado.edicao_vazia`). */
function edicaoVazia(e: EdicaoBoletim): boolean {
  return Object.keys(e.textos ?? {}).length === 0 && (e.ocultos ?? []).length === 0 && (e.fotos_ocultas ?? []).length === 0
}

function validarEdicaoFixture(e: EdicaoBoletim): void {
  const o = e as unknown
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new ErroAdmin('Edição do boletim inválida')
  for (const k of Object.keys(o)) {
    if (k !== 'textos' && k !== 'ocultos' && k !== 'fotos_ocultas') throw new ErroAdmin('Edição do boletim inválida')
  }
}

/** Snapshot pequeno e coerente: uma obra com serviço, pendências, observação e um lançamento tardio. */
function snapshotFixture(data: string): SnapshotBoletim {
  const foto = (n: string) => ({ path: `etapa/fotos/${data}-${n}.jpg`, largura: 1200, altura: 900 })
  return {
    data,
    obras: [
      {
        id: 'obra-hto',
        nome: 'HTO',
        servicos: [
          { id: `srv-${data}-1`, pavimento: 'Térreo', ambiente: 'Sala 01', hora: '09:10', autor: 'CP PATRICIO', legenda: 'Concretagem da laje concluída', fotos: [foto('a'), foto('b')] },
          { id: `srv-${data}-2`, pavimento: '1º pavimento', ambiente: 'Corredor', hora: '14:40', autor: 'CP PATRICIO', legenda: null, fotos: [foto('c')] },
        ],
        pendencias_abertas: [
          { id: `pen-${data}-1`, pavimento: 'Térreo', ambiente: 'Sala 02', hora: '10:25', autor: 'CP PATRICIO', legenda: 'Infiltração na parede norte', fotos: [foto('d')] },
        ],
        pendencias_encerradas: [
          {
            id: `enc-${data}-1`,
            pavimento: '1º pavimento',
            ambiente: 'Sala 11',
            aberta_em: somarDias(data, -3),
            dias_aberta: 3,
            legenda: 'Tomada sem espelho',
            fotos_registro: [],
            encerramento: { hora: '16:00', autor: 'CP PATRICIO', observacao: 'Espelho instalado', fotos: [foto('e')] },
          },
        ],
        observacoes: [{ hora: '11:30', autor: 'CP PATRICIO', texto: 'Chuva forte pela manhã, sem impacto.', editada: false }],
      },
    ],
    tardios: [
      { id: `tar-${data}-1`, tipo: 'servico', data, hora: '17:20', recebido_em: `${somarDias(data, 1)}T09:00:00-03:00`, obra: 'HTO', ambiente: 'Sala 01', autor: 'CP PATRICIO', texto: 'Limpeza final do pavimento' },
    ],
  }
}

const ORFAOS_BASE: ResumoOrfaos = {
  buckets: [
    { bucket: 'fotos', quantidade: 2, bytes: 3_145_728 },
    { bucket: 'modelos', quantidade: 1, bytes: 52_428_800 },
  ],
  maiores: [
    { bucket: 'modelos', caminho: 'obra-x/ARQ/0123456789abcdef.frag', tamanho: 52_428_800, criado_em: '2026-10-01T10:00:00Z', detectado_em: '2026-11-17T03:17:00Z' },
    { bucket: 'fotos', caminho: 'obra-x/registro-1/foto-1.jpg', tamanho: 2_097_152, criado_em: '2026-10-02T10:00:00Z', detectado_em: '2026-11-17T03:17:00Z' },
    { bucket: 'fotos', caminho: 'obra-x/registro-1/foto-2.jpg', tamanho: 1_048_576, criado_em: '2026-10-02T10:00:00Z', detectado_em: '2026-11-17T03:17:00Z' },
  ],
}

const ERROS_CLIENTE_BASE: ErroCliente[] = [
  {
    id: 2,
    criado_em: '2026-11-18T14:32:00Z',
    usuario_id: 'usuario-maria',
    usuario_nome: 'Maria Souza',
    app: 'miniapp',
    versao: 'v54.261118.abc1234',
    rota: '/obras/hto-bloco-a',
    mensagem: "Cannot read properties of undefined (reading 'nome')",
    pilha: "TypeError: Cannot read properties of undefined (reading 'nome')\n    at Obra (obra.tsx:42:10)",
    agente: 'Mozilla/5.0 (Linux; Android 14) Telegram',
    contexto: { componentStack: '\n    at Obra\n    at App' },
  },
  {
    id: 1,
    criado_em: '2026-11-17T09:05:00Z',
    usuario_id: null,
    usuario_nome: null,
    app: 'admin',
    versao: 'v54.261118.abc1234',
    rota: '/admin/boletins',
    mensagem: 'Failed to fetch',
    pilha: null,
    agente: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
    contexto: null,
  },
]

export function criarRepositorioAdminFixture(opcoes: { admin?: boolean; sessao?: boolean } = {}): RepositorioAdmin {
  const etapas: EtapaMemoria[] = [
    {
      id: 'etapa-2a',
      slug: '2a-etapa',
      nome: '2ª ETAPA',
      ordem: 2,
      telegram_chat_id: GRUPO_2A,
      telegram_chat_titulo: 'Fiscalização 2ª ETAPA',
      arquivada_em: null,
      ...CAMPOS_VAZIOS,
      sigla: '2',
      endereco: 'Av. Santos Dumont, 1500 - Aldeota, Fortaleza - CE',
      latitude: -3.761,
      longitude: -38.5297,
      fuso: 'America/Fortaleza',
      estacao: '8836',
      estacao_reserva: '9281',
      objeto: 'CONSTRUÇÃO DO HOTEL DE TRÂNSITO DE OFICIAIS (HTO) E DA SEDE DA COMISSÃO DE OBRAS',
      local: 'CAMPUS DO COMANDO\nFORTALEZA - CE',
      contratante: 'SECRETARIA DE OBRAS PÚBLICAS',
      contrato: '120/2025 - SOP',
      contratada: 'CONSTRUTORA EXEMPLO LTDA',
      contratada_cnpj: '12.345.678/0001-95',
      os_numero: '120/2025',
      os_data: '2025-06-02',
      vigencia_meses: 24,
      valor_original: 79499000,
      area_construida_m2: 86102.17,
      aditivos: [
        { id: 'aditivo-1', etapa_id: 'etapa-2a', numero: '1º TA', data: '2026-03-10', prazo_dias: 90, valor: 1250000, descricao: 'Reprogramação de fundações' },
      ],
      responsaveis: [{ usuario_id: 'usuario-patricio', funcao: 'Fiscal' }],
    },
    {
      id: 'etapa-3a',
      slug: '3a-etapa',
      nome: '3ª ETAPA',
      ordem: 3,
      telegram_chat_id: null,
      telegram_chat_titulo: null,
      arquivada_em: null,
      ...CAMPOS_VAZIOS,
      aditivos: [],
      responsaveis: [],
    },
  ]
  /** Boletins e pedidos de emissão da 2ª etapa (datas relativas a hoje, no fuso da etapa). */
  const hoje2a = hojeNoFuso('America/Fortaleza')
  const dia = (n: number) => somarDias(hoje2a, n)
  const boletimFixture = (
    etapaId: string,
    sigla: string,
    data: string,
    revisao: number,
    por: string | null,
    publicado: boolean,
  ): BoletimMemoria => {
    const numero = numeroBoletim(sigla, data, 'CO-FZ') + (revisao > 0 ? `-R${revisao}` : '')
    return {
      id: `boletim-${etapaId === 'etapa-2a' ? '' : '3a-'}${data}-${revisao}`,
      etapa_id: etapaId,
      data,
      revisao,
      numero,
      emitido_em: `${revisao > 0 ? dia(-1) : data}T${revisao > 0 ? '13:05' : '23:30'}:00-03:00`,
      emitido_por_nome: por,
      pdf_path: `${etapaId}/${numero.replace(/\//g, '')}.pdf`,
      publicado,
      publicacao_estado: publicado ? 'publicado' : 'pendente',
      publicacao_erro: null,
      publicacao_tentativas: 0,
      base_numero: null,
      edicao: null,
      rascunho: null,
      snapshot: snapshotFixture(data),
    }
  }
  const b2aAntigo = boletimFixture('etapa-2a', '2', dia(-45), 0, null, true)
  const b2aOriginal = boletimFixture('etapa-2a', '2', dia(-2), 0, null, true)
  // Retificação editada: nasceu da edição do boletim original do dia.
  const b2aEditado: BoletimMemoria = {
    ...boletimFixture('etapa-2a', '2', dia(-2), 1, 'CP PATRICIO', true),
    base_numero: b2aOriginal.numero,
    edicao: { textos: { [`servico:srv-${dia(-2)}-1`]: 'Concretagem da laje do térreo concluída' }, ocultos: [`servico:srv-${dia(-2)}-2`] },
  }
  // Boletim ainda não publicado, com um rascunho salvo.
  const b2aRascunho: BoletimMemoria = {
    ...boletimFixture('etapa-2a', '2', dia(-1), 0, null, false),
    rascunho: {
      edicao: { ocultos: [`aberta:pen-${dia(-1)}-1`], fotos_ocultas: [`etapa/fotos/${dia(-1)}-a.jpg`] },
      atualizado_em: `${dia(-1)}T15:20:00-03:00`,
      atualizado_por_nome: 'CP PATRICIO',
    },
  }
  const b3a = boletimFixture('etapa-3a', '3', dia(-1), 0, null, true)
  const boletins: BoletimMemoria[] = [b2aAntigo, b2aOriginal, b2aEditado, b2aRascunho, b3a]
  const pedidos: PedidoMemoria[] = [
    {
      id: 1,
      etapa_id: 'etapa-2a',
      data: dia(-3),
      revisao: 0,
      estado: 'falhou',
      tentativas: 8,
      erro: 'Tempo esgotado ao gerar o PDF',
      atualizado_em: `${dia(-2)}T03:10:00-03:00`,
    },
  ]
  let sequenciaPedido = pedidos.length
  const obras: ObraMemoria[] = [
    obraDoJson('obra-hto', 0, obraHto as unknown as ObraJson, ambientesHto as unknown as AmbientesJson, 'etapa-2a', GRUPO_2A),
    obraDoJson('obra-cofz', 1, obraCofz as unknown as ObraJson, ambientesCofz as unknown as AmbientesJson, 'etapa-2a', null),
  ]
  let sequencia = 0
  function etapaPorSlug(slug: string): EtapaMemoria {
    const e = etapas.find((x) => x.slug === slug)
    if (!e) throw new ErroAdmin('Etapa não encontrada')
    return e
  }
  function exigirAdmin(): void {
    if (!sessaoAdm.temSessaoAtiva()) throw new ErroAdmin('Sua sessão expirou. Entre de novo.')
    if (!acessosAdm.ehAdmin()) throw new ErroAdmin('Acesso negado: apenas admins do Mini App.')
  }

  function obraPorSlug(slug: string): ObraMemoria {
    const o = obras.find((x) => x.slug === slug)
    if (!o) throw new ErroAdmin('Obra não encontrada')
    return o
  }
  const etapaDe = (o: ObraMemoria): EtapaMemoria => etapas.find((e) => e.id === o.etapa_id)!

  const acessosAdm = criarAcessosAdminFixture({
    admin: opcoes.admin !== false,
    voce: VOCE,
    usuarios: USUARIOS_BASE,
    obras: () => obras.map((o) => ({ id: o.id, slug: o.slug, nome: o.nome, etapaNome: etapaDe(o).nome })),
    exigirAdmin,
  })
  const sessaoAdm = criarSessaoAdminFixture({
    sessaoInicial: opcoes.sessao !== false,
    voce: VOCE,
    ehAdmin: acessosAdm.ehAdmin,
  })
  const ra = criarRaFixture({ exigirAdmin })
  const plantas = criarPlantasFixture({
    exigirAdmin,
    obraPorSlug,
    obraExiste: (id) => obras.some((o) => o.id === id),
    proximoId: () => ++sequencia,
    nomeUsuario: VOCE.nome,
  })
  const modelos = criarModelosFixture({
    exigirAdmin,
    obraPorSlug,
    tamanhoArquivo: (caminho) => plantas.tamanhoArquivo(`modelos/${caminho}`),
    proximoId: () => ++sequencia,
    nomeUsuario: VOCE.nome,
  })

  const obrasAdm = criarObrasAdminFixture({
    obras,
    etapas,
    exigirAdmin,
    proximoId: () => ++sequencia,
    nomeUsuario: VOCE.nome,
    contagens: (o) => ({
      ambientes: plantas.quantidadeAmbientes(o.id),
      plantas: plantas.quantidadePlantas(o.id),
      modelos: modelos.quantidade(o.id),
      arquivos: plantas.contarArquivos(o.id),
    }),
    removerArquivos: (o) => {
      modelos.removerObra(o.id)
      return plantas.removerObra(o.id)
    },
  })
  const etapasAdm = criarEtapasAdminFixture({
    etapas,
    obras,
    usuarios: USUARIOS_BASE,
    nomeExibicao: acessosAdm.nomeExibicao,
    exigirAdmin,
    proximoId: () => ++sequencia,
    resumoObra: obrasAdm.resumoDe,
    removerObra: obrasAdm.removerObra,
    aoExcluirEtapa: (etapaId) => {
      for (const lista of [boletins, pedidos] as { etapa_id: string }[][]) {
        for (let i = lista.length - 1; i >= 0; i--) if (lista[i].etapa_id === etapaId) lista.splice(i, 1)
      }
    },
  })
  const organizacaoAdm = criarOrganizacaoAdminFixture({ exigirAdmin })

  return {
    listarRA: ra.listarRA,
    definirQr: ra.definirQr,
    removerQr: ra.removerQr,
    estadoSessao: sessaoAdm.estadoSessao,
    entrarComToken: sessaoAdm.entrarComToken,
    entrarComWidget: sessaoAdm.entrarComWidget,
    entrarModoTeste: sessaoAdm.entrarModoTeste,
    sair: sessaoAdm.sair,
    meuId: sessaoAdm.meuId,
    listarPessoas: acessosAdm.listarPessoas,
    definirNomeExibicao: acessosAdm.definirNomeExibicao,
    matrizAcessos: acessosAdm.matrizAcessos,
    definirAcesso: acessosAdm.definirAcesso,
    listarAdmins: acessosAdm.listarAdmins,
    incluirAdmin: acessosAdm.incluirAdmin,
    removerAdmin: acessosAdm.removerAdmin,
    listarUsuarios: acessosAdm.listarUsuarios,

    listarEtapas: etapasAdm.listarEtapas,
    salvarEtapa: etapasAdm.salvarEtapa,
    obterEtapa: etapasAdm.obterEtapa,
    salvarAditivo: etapasAdm.salvarAditivo,
    removerAditivo: etapasAdm.removerAditivo,
    definirResponsaveis: etapasAdm.definirResponsaveis,
    arquivarEtapa: etapasAdm.arquivarEtapa,
    desvincularEtapa: etapasAdm.desvincularEtapa,
    resumoEtapa: etapasAdm.resumoEtapa,
    excluirEtapa: etapasAdm.excluirEtapa,
    obterOrganizacao: organizacaoAdm.obterOrganizacao,
    salvarOrganizacao: organizacaoAdm.salvarOrganizacao,
    enviarLogo: organizacaoAdm.enviarLogo,
    listarObras: obrasAdm.listarObras,
    obterObra: obrasAdm.obterObra,
    salvarObra: obrasAdm.salvarObra,
    salvarPavimentos: obrasAdm.salvarPavimentos,
    salvarConfig: obrasAdm.salvarConfig,
    exportarObra: obrasAdm.exportarObra,
    arquivarObra: obrasAdm.arquivarObra,
    resumoObra: obrasAdm.resumoObra,
    excluirObra: obrasAdm.excluirObra,
    listarExclusoes: obrasAdm.listarExclusoes,
    limparExclusao: obrasAdm.limparExclusao,

    async listarBoletins(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const ordem = (a: { data: string; revisao: number }, b: { data: string; revisao: number }) =>
        b.data.localeCompare(a.data) || b.revisao - a.revisao
      return {
        boletins: boletins
          .filter((x) => x.etapa_id === e.id)
          .map(emitidoDe)
          .sort(ordem),
        pedidos: pedidos
          .filter((x) => x.etapa_id === e.id && x.estado !== 'emitido')
          .map(pedidoPublico)
          .sort(ordem),
      }
    },

    async pedirEmissao(slug, data) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      if (!dataValida(data)) throw new ErroAdmin('Data inválida: use AAAA-MM-DD')
      if (data > hojeNoFuso(e.fuso)) throw new ErroAdmin('Não é possível emitir o boletim de uma data futura')
      if (e.sigla === null) throw new ErroAdmin('A etapa não tem sigla')
      if (pedidos.some((p) => p.etapa_id === e.id && p.data === data && (p.estado === 'pendente' || p.estado === 'gerando'))) {
        throw new ErroAdmin(`Já existe um pedido de emissão em andamento para ${dataBr(data)}`)
      }
      const doDia = boletins.filter((b) => b.etapa_id === e.id && b.data === data)
      const revisao = doDia.length === 0 ? 0 : Math.max(...doDia.map((b) => b.revisao)) + 1
      const nomeOm = (await organizacaoAdm.obterOrganizacao()).nome
      const numeroDe = (r: number) => numeroBoletim(e.sigla as string, data, nomeOm) + (r > 0 ? `-R${r}` : '')
      const agora = new Date().toISOString()
      // Um pedido que falhou para a mesma revisão volta para a fila.
      const antigo = pedidos.find((p) => p.etapa_id === e.id && p.data === data && p.revisao === revisao)
      if (antigo) {
        Object.assign(antigo, { estado: 'pendente', tentativas: 0, erro: null, atualizado_em: agora })
        return { ...pedidoPublico(antigo), numero: numeroDe(revisao) }
      }
      const novo = { id: ++sequenciaPedido, etapa_id: e.id, data, revisao, estado: 'pendente' as const, tentativas: 0, erro: null, atualizado_em: agora }
      pedidos.push(novo)
      return { ...pedidoPublico(novo), numero: numeroDe(revisao) }
    },

    async reenviarBoletim(slug, boletimId) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const b = boletins.find((x) => x.id === boletimId && x.etapa_id === e.id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      if (e.telegram_chat_id === null) throw new ErroAdmin('A etapa não tem grupo do Telegram vinculado')
      if (b.publicado || b.publicacao_estado === 'publicado') throw new ErroAdmin('Este boletim já foi publicado no grupo')
      if (b.publicacao_estado === 'pendente' || b.publicacao_estado === 'enviando') {
        throw new ErroAdmin('O envio deste boletim já está em andamento')
      }
      Object.assign(b, { publicacao_estado: 'pendente', publicacao_erro: null, publicacao_tentativas: 0 })
    },

    async excluirBoletim(slug, boletimId) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const b = boletins.find((x) => x.id === boletimId && x.etapa_id === e.id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      const doDia = boletins.filter((x) => x.etapa_id === e.id && x.data === b.data)
      const apagadas = doDia.filter((x) => x.publicacao_estado === 'publicado').length
      for (let i = boletins.length - 1; i >= 0; i--) if (doDia.includes(boletins[i])) boletins.splice(i, 1)
      for (let i = pedidos.length - 1; i >= 0; i--) if (pedidos[i].etapa_id === e.id && pedidos[i].data === b.data) pedidos.splice(i, 1)
      return { numero: b.numero, data: b.data, revisoes: doDia.length, mensagens: { apagadas, falhas: 0 }, arquivos_erro: null }
    },

    async urlPdfBoletim(caminho) {
      exigirAdmin()
      const b = boletins.find((x) => x.pdf_path === caminho)
      if (!b) throw new ErroAdmin('PDF do boletim não encontrado')
      return URL.createObjectURL(new Blob([pdfMinimo(`Boletim ${b.numero} (fixture)`)], { type: 'application/pdf' }))
    },

    async previaBoletim(slug, data) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      if (!dataValida(data)) throw new ErroAdmin('Data inválida: use AAAA-MM-DD')
      if (data > hojeNoFuso(e.fuso)) throw new ErroAdmin('Não é possível gerar a prévia de uma data futura')
      return new Blob([pdfMinimo(`PREVIA - sem numero - ${e.nome} - ${dataBr(data)}`)], { type: 'application/pdf' })
    },

    async listarTodosBoletins(filtro = {}) {
      exigirAdmin()
      const etapa = filtro.etapa ? etapaPorSlug(filtro.etapa) : null
      const noPeriodo = (x: { etapa_id: string; data: string }) =>
        (!etapa || x.etapa_id === etapa.id) && (!filtro.de || x.data >= filtro.de) && (!filtro.ate || x.data <= filtro.ate)
      const nomeDe = (id: string) => etapas.find((e) => e.id === id)?.nome ?? ''
      const slugDe = (id: string) => etapas.find((e) => e.id === id)?.slug ?? ''
      const ordem = (a: { data: string; etapa_nome: string; revisao: number }, b: { data: string; etapa_nome: string; revisao: number }) =>
        b.data.localeCompare(a.data) || a.etapa_nome.localeCompare(b.etapa_nome) || b.revisao - a.revisao
      return {
        boletins: boletins
          .filter(noPeriodo)
          .map(
            (b): BoletimDaLista => ({
              ...emitidoDe(b),
              etapa_slug: slugDe(b.etapa_id),
              etapa_nome: nomeDe(b.etapa_id),
              base_numero: b.base_numero,
              editado: b.edicao !== null,
              tem_rascunho: b.rascunho !== null,
            }),
          )
          .sort(ordem)
          .slice(0, 300),
        pedidos: pedidos
          .filter((p) => p.estado !== 'emitido' && noPeriodo(p))
          .map((p) => ({ ...pedidoPublico(p), etapa_slug: slugDe(p.etapa_id), etapa_nome: nomeDe(p.etapa_id), editado: p.edicao !== undefined }))
          .sort(ordem),
      }
    },

    async boletim(id) {
      exigirAdmin()
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      const e = etapas.find((x) => x.id === b.etapa_id)!
      const doDia = boletins.filter((x) => x.etapa_id === b.etapa_id && x.data === b.data)
      const detalhe: BoletimDetalhe = {
        ...emitidoDe(b),
        etapa_slug: e.slug,
        etapa_nome: e.nome,
        ultima_revisao: !doDia.some((x) => x.revisao > b.revisao),
        emissao_em_andamento: pedidos.some(
          (p) => p.etapa_id === b.etapa_id && p.data === b.data && (p.estado === 'pendente' || p.estado === 'gerando'),
        ),
        base_numero: b.base_numero,
        edicao: b.edicao,
        snapshot: b.snapshot,
        rascunho: b.rascunho,
      }
      return copia(detalhe)
    },

    async salvarRascunhoBoletim(id, edicao) {
      exigirAdmin()
      validarEdicaoFixture(edicao)
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      if (boletins.some((x) => x.etapa_id === b.etapa_id && x.data === b.data && x.revisao > b.revisao)) {
        throw new ErroAdmin('Só a última revisão do dia pode ser editada')
      }
      if (edicaoVazia(edicao)) {
        b.rascunho = null
        return null
      }
      const atualizado_em = new Date().toISOString()
      b.rascunho = { edicao: copia(edicao), atualizado_em, atualizado_por_nome: VOCE.nome }
      return { atualizado_em }
    },

    async retificarBoletim(id, edicao) {
      exigirAdmin()
      validarEdicaoFixture(edicao)
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      const e = etapas.find((x) => x.id === b.etapa_id)!
      if (boletins.some((x) => x.etapa_id === b.etapa_id && x.data === b.data && x.revisao > b.revisao)) {
        throw new ErroAdmin('Só a última revisão do dia pode ser editada')
      }
      if (edicaoVazia(edicao)) throw new ErroAdmin('Nenhuma alteração para enviar')
      if (pedidos.some((p) => p.etapa_id === b.etapa_id && p.data === b.data && (p.estado === 'pendente' || p.estado === 'gerando'))) {
        throw new ErroAdmin('Já há uma emissão em andamento para este dia')
      }
      const revisao = Math.max(...boletins.filter((x) => x.etapa_id === b.etapa_id && x.data === b.data).map((x) => x.revisao)) + 1
      const numero = numeroBoletim(e.sigla ?? '3', b.data, (await organizacaoAdm.obterOrganizacao()).nome) + `-R${revisao}`
      const agora = new Date().toISOString()
      const antigo = pedidos.find((p) => p.etapa_id === b.etapa_id && p.data === b.data && p.revisao === revisao)
      const pedido: PedidoMemoria =
        antigo ?? { id: ++sequenciaPedido, etapa_id: b.etapa_id, data: b.data, revisao, estado: 'pendente', tentativas: 0, erro: null, atualizado_em: agora }
      Object.assign(pedido, { estado: 'pendente', tentativas: 0, erro: null, atualizado_em: agora, edicao: copia(edicao) })
      if (!antigo) pedidos.push(pedido)
      b.rascunho = { edicao: copia(edicao), atualizado_em: agora, atualizado_por_nome: VOCE.nome }
      return { ...pedidoPublico(pedido), numero }
    },

    async previaBoletimEditado(id, edicao) {
      exigirAdmin()
      validarEdicaoFixture(edicao)
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      return new Blob([pdfMinimo(`PREVIA EDITADA - sem numero - ${b.numero}`)], { type: 'application/pdf' })
    },

    async urlsFotos(paths) {
      exigirAdmin()
      const r: Record<string, string> = {}
      for (const p of new Set(paths)) {
        r[p] = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ccc"/><text x="6" y="48" font-size="9">${p.split('/').pop()}</text></svg>`)}`
      }
      return r
    },

    obterEditorPlanta: plantas.obterEditorPlanta,
    listarPublicacoes: plantas.listarPublicacoes,
    enviarArquivo: plantas.enviarArquivo,
    baixarOriginal: plantas.baixarOriginal,
    publicarRevisao: plantas.publicarRevisao,
    listarModelosAdmin: modelos.listarModelosAdmin,
    registrarModelo: modelos.registrarModelo,
    retirarModelo: modelos.retirarModelo,

    async listarErrosCliente(limite = 200): Promise<ErroCliente[]> {
      exigirAdmin()
      return ERROS_CLIENTE_BASE.slice(0, limite)
    },

    async resumoOrfaos(): Promise<ResumoOrfaos> {
      exigirAdmin()
      return copia(ORFAOS_BASE)
    },
  }
}
