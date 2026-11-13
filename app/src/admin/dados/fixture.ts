/**
 * Repositório de teste do site de administração (VITE_DADOS=fixture): HTO e COFZ com a
 * configuração real de `data/<slug>/obra.json`, na etapa "2ª ETAPA", mais a "3ª ETAPA" vazia e a
 * organização "CO-FZ" sem logo, tudo em memória. Reproduz as regras das RPCs (slug, pavimento com
 * ambientes, último admin, etapas). Nunca entra no build de produção.
 */
import ambientesCofz from '../../../../data/cofz/ambientes.json'
import obraCofz from '../../../../data/cofz/obra.json'
import plantasCofz from '../../../../data/cofz/plantas.json'
import ambientesHto from '../../../../data/hto/ambientes.json'
import obraHto from '../../../../data/hto/obra.json'
import plantasHto from '../../../../data/hto/plantas.json'
import { ehWebp } from '../planta/render.ts'
import { dataBr, hojeNoFuso, numeroBoletim } from '../formato.ts'
import { aplicarCampos, calcularFaltando, calcularPrazo, CAMPOS_VAZIOS, camposDe, dataValida, somarDias } from './fixtureBoletim.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import {
  CABECALHO_LINHA_MAX,
  CABECALHO_LINHAS_MAX,
  CAMINHO_LOGO,
  ErroAdmin,
  NOME_OM_MAX,
  novoCaminhoLogo,
  problemaDoLogo,
  type Admin,
  type AmbienteBanco,
  type ConfigObra,
  type EstadoSessao,
  type BucketObra,
  type Aditivo,
  type CamposEtapa,
  type BoletimEmitido,
  type PedidoEmissao,
  type EtapaDetalhe,
  type EtapaLista,
  type Pessoa,
  type Responsavel,
  type Organizacao,
  type AmbienteRA,
  type EventoModelo,
  type QrAmbiente,
  type Exclusao,
  type ModeloAdmin,
  type ObraAdmin,
  type ObraLista,
  type PavimentoAdmin,
  type PavimentoResumo,
  type PlantaAtiva,
  type ResumoObra,
  type Publicacao,
  type UsuarioApp,
} from './tipos.ts'

const SLUG = /^[a-z0-9-]+$/
const CODIGO = /^[a-z0-9][a-z0-9-]*$/

interface ObraJson {
  slug: string
  nome: string
  pavimentos: { codigo: string; nome: string; ordem: number; pdf?: string; pagina?: number }[]
  [chave: string]: unknown
}

interface AmbientesJson {
  ambientes: {
    id: string
    pavimento: string
    nome_operacional: string
    nome_planta: string | null
    categoria: string
    area_m2: number | null
    revisao: string
    marcadores: { x: number; y: number; rotulo_bbox?: [number, number, number, number] }[]
  }[]
  ambientes_removidos?: { id: string; pavimento: string; nome_operacional: string; revisao_ultima?: string | null }[]
}

interface PlantasJson {
  pavimentos: { id: string; revisao: string; sha256: string; pagina_pt: [number, number]; recorte_pt: number[] }[]
}

/** Estado da planta de uma obra na fixture (o que as RPCs da fase 2 leem e gravam). */
interface PlantaMemoria {
  ambientes: AmbienteBanco[]
  /** pavimento → planta ativa */
  plantas: Map<string, PlantaAtiva>
}

function plantaDoJson(ambientes: AmbientesJson, plantas: PlantasJson): PlantaMemoria {
  const lista: AmbienteBanco[] = ambientes.ambientes.map((a, i) => ({
    codigo: a.id,
    pavimento: a.pavimento,
    nome_operacional: a.nome_operacional,
    nome_planta: a.nome_planta,
    categoria: a.categoria,
    area_m2: a.area_m2,
    revisao_planta: a.revisao,
    marcadores: a.marcadores,
    ordem: i + 1,
    ativo: true,
  }))
  for (const r of ambientes.ambientes_removidos ?? []) {
    lista.push({
      codigo: r.id,
      pavimento: r.pavimento,
      nome_operacional: r.nome_operacional,
      nome_planta: null,
      categoria: 'area_comum',
      area_m2: null,
      revisao_planta: r.revisao_ultima ?? null,
      marcadores: [],
      ordem: lista.length + 1,
      ativo: false,
    })
  }
  return {
    ambientes: lista,
    plantas: new Map(
      plantas.pavimentos.map((p) => [
        p.id,
        {
          revisao: p.revisao,
          pdf_sha256: p.sha256,
          pagina_pt: p.pagina_pt,
          recorte_pt: p.recorte_pt as [number, number, number, number],
          criado_em: '2026-11-11T12:00:00Z',
        },
      ]),
    ),
  }
}

interface ObraMemoria {
  id: string
  slug: string
  nome: string
  ordem: number
  pavimentos: (PavimentoResumo & { id: string; ambientes: number })[]
  config: ConfigObra | null
  config_atualizada_em: string | null
  config_atualizada_por: string | null
  arquivada_em: string | null
  etapa_id: string
  /** Grupo do Telegram do tópico vinculado (`obra.telegram_chat_id`); null sem vínculo. */
  telegram_chat_id: number | null
}

interface EtapaMemoria extends CamposEtapa {
  aditivos: Aditivo[]
  /** Responsáveis na ordem (a `ordem` sai da posição). */
  responsaveis: { usuario_id: string; funcao: string }[]
  id: string
  slug: string
  nome: string
  ordem: number
  telegram_chat_id: number | null
  telegram_chat_titulo: string | null
  arquivada_em: string | null
}

/** Grupo do Telegram da 2ª ETAPA na fixture. */
const GRUPO_2A = -1001234567890

/** Lê o arquivo como data URL (a fixture guarda o logo em memória). */
function dataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(String(leitor.result))
    leitor.onerror = () => rejeitar(leitor.error ?? new Error('Falha ao ler o arquivo'))
    leitor.readAsDataURL(arquivo)
  })
}

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

/** Geometria de teste (HTO): um retângulo de 6,03 × 3,96 m e um ambiente em L, o primeiro com QR. */
function geometriaHto(): AmbienteRA[] {
  return [
    {
      ambiente_id: 'terreo-administracao',
      codigo: 'terreo-administracao',
      nome: 'Administração',
      pavimento: 'Térreo',
      contorno: [
        [0, 0],
        [6.03, 0],
        [6.03, 3.96],
        [0, 3.96],
      ],
      y_piso: -0.805,
      y_teto: 1.795,
      qr: { parede: 0, distancia_m: 2.5, altura_m: 1.5, lado_m: 0.18 },
    },
    {
      ambiente_id: 'terreo-alojamento',
      codigo: 'terreo-alojamento',
      nome: 'Alojamento',
      pavimento: 'Térreo',
      contorno: [
        [0, 0],
        [5, 0],
        [5, 2],
        [3, 2],
        [3, 4],
        [0, 4],
      ],
      y_piso: -0.805,
      y_teto: 1.795,
      qr: null,
    },
  ]
}

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Cópia sem o `etapa_id` interno (boletins e pedidos da fixture). */
function semEtapa<T extends { etapa_id: string }>(x: T): Omit<T, 'etapa_id'> {
  const r: Partial<T> = copia(x)
  delete r.etapa_id
  return r as Omit<T, 'etapa_id'>
}

export function criarRepositorioAdminFixture(opcoes: { admin?: boolean; sessao?: boolean } = {}): RepositorioAdmin {
  const ehAdmin = opcoes.admin !== false
  let sessao = opcoes.sessao !== false
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
  const boletimFixture = (data: string, revisao: number, por: string | null, publicado: boolean): BoletimEmitido & { etapa_id: string } => {
    const numero = numeroBoletim('2', data, 'CO-FZ') + (revisao > 0 ? `-R${revisao}` : '')
    return {
      id: `boletim-${data}-${revisao}`,
      etapa_id: 'etapa-2a',
      data,
      revisao,
      numero,
      emitido_em: `${revisao > 0 ? dia(-1) : data}T${revisao > 0 ? '13:05' : '23:30'}:00-03:00`,
      emitido_por_nome: por,
      pdf_path: `etapa-2a/${numero.replace(/\//g, '')}.pdf`,
      publicado,
    }
  }
  const boletins: (BoletimEmitido & { etapa_id: string })[] = [
    boletimFixture(dia(-2), 0, null, true),
    boletimFixture(dia(-2), 1, 'CP PATRICIO', true),
    boletimFixture(dia(-1), 0, null, false),
  ]
  const pedidos: (PedidoEmissao & { etapa_id: string })[] = [
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
  const organizacao = {
    nome: 'CO-FZ',
    logo_path: null as string | null,
    cabecalho: [
      'COMANDO DA AERONÁUTICA',
      'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA',
      'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)',
    ],
  }
  /** `usuario.nome_exibicao`. */
  const nomesExibicao = new Map<string, string | null>([['usuario-patricio', 'CP PATRICIO']])
  const nomeExibicao = (id: string) => nomesExibicao.get(id) ?? null
  /** Papel de cada pessoa em cada obra (para "participações" da tela de pessoas). */
  const participantes: { usuario_id: string; obra_id: string; papel: string }[] = [
    { usuario_id: 'usuario-patricio', obra_id: 'obra-hto', papel: 'gestor' },
    { usuario_id: 'usuario-eduardo', obra_id: 'obra-hto', papel: 'equipe' },
    { usuario_id: 'usuario-maria', obra_id: 'obra-cofz', papel: 'equipe' },
  ]
  /** Logos enviados: caminho → data URL. */
  const logos = new Map<string, string>()
  const organizacaoAtual = (): Organizacao => ({
    nome: organizacao.nome,
    logo_path: organizacao.logo_path,
    cabecalho: [...organizacao.cabecalho],
    logo_url: organizacao.logo_path ? (logos.get(organizacao.logo_path) ?? null) : null,
  })
  const admins = new Map<string, { criado_em: string; criado_por: string | null }>([
    [VOCE.id, { criado_em: '2026-11-11T12:00:00Z', criado_por: null }],
    ['usuario-patricio', { criado_em: '2026-11-11T12:00:00Z', criado_por: null }],
  ])
  if (!ehAdmin) admins.delete(VOCE.id)
  let sequencia = 0
  const plantaPorObra = new Map<string, PlantaMemoria>([
    ['obra-hto', plantaDoJson(ambientesHto as unknown as AmbientesJson, plantasHto as unknown as PlantasJson)],
    ['obra-cofz', plantaDoJson(ambientesCofz as unknown as AmbientesJson, plantasCofz as unknown as PlantasJson)],
  ])
  const publicacoes: (Publicacao & { obra_id: string })[] = []
  const arquivos = new Map<string, Blob>()
  const modelosPorObra = new Map<string, ModeloAdmin[]>()
  const historicoModelos: (EventoModelo & { obra_id: string })[] = []
  const exclusoes: Exclusao[] = []
  const geometriaPorObra = new Map<string, AmbienteRA[]>([['obra-hto', geometriaHto()]])
  /** Arquivos da obra por bucket (o id da obra é a 1ª pasta em todos). */
  const arquivosDaObra = (obraId: string) =>
    [...arquivos.keys()].filter((k) => k.split('/')[1] === obraId).map((k) => k.split('/')[0] as BucketObra)
  function resumoDe(o: ObraMemoria): ResumoObra {
    const contagem: Record<BucketObra, number> = { fotos: 0, plantas: 0, originais: 0, modelos: 0 }
    for (const b of arquivosDaObra(o.id)) contagem[b] = (contagem[b] ?? 0) + 1
    const planta = plantaPorObra.get(o.id)
    return {
      registros: 0,
      fotos: 0,
      ambientes: planta?.ambientes.length ?? 0,
      pavimentos: o.pavimentos.length,
      plantas: planta?.plantas.size ?? 0,
      modelos: modelosPorObra.get(o.id)?.length ?? 0,
      participantes: 0,
      publicacoes_telegram: 0,
      arquivos: contagem,
    }
  }
  const plantaDe = (o: ObraMemoria): PlantaMemoria => {
    let p = plantaPorObra.get(o.id)
    if (!p) {
      p = { ambientes: [], plantas: new Map() }
      plantaPorObra.set(o.id, p)
    }
    return p
  }

  function exigirAdmin(): void {
    if (!sessao) throw new ErroAdmin('Sua sessão expirou. Entre de novo.')
    if (!admins.has(VOCE.id)) throw new ErroAdmin('Acesso negado: apenas admins do Mini App.')
  }

  function obraPorSlug(slug: string): ObraMemoria {
    const o = obras.find((x) => x.slug === slug)
    if (!o) throw new ErroAdmin('Obra não encontrada')
    return o
  }

  function etapaPorSlug(slug: string): EtapaMemoria {
    const e = etapas.find((x) => x.slug === slug)
    if (!e) throw new ErroAdmin('Etapa não encontrada')
    return e
  }
  const nomeDaPessoa = (id: string) => USUARIOS_BASE.find((u) => u.id === id)?.nome ?? ''
  function responsaveisDe(e: EtapaMemoria): Responsavel[] {
    return e.responsaveis.map((r, i) => ({
      usuario_id: r.usuario_id,
      nome: nomeDaPessoa(r.usuario_id),
      nome_exibicao: nomeExibicao(r.usuario_id),
      funcao: r.funcao,
      ordem: i,
    }))
  }
  function detalheDe(e: EtapaMemoria): EtapaDetalhe {
    const campos = camposDe(e)
    return {
      ...campos,
      id: e.id,
      slug: e.slug,
      nome: e.nome,
      ordem: e.ordem,
      arquivada_em: e.arquivada_em,
      telegram_vinculado: e.telegram_chat_id !== null,
      telegram_chat_titulo: e.telegram_chat_titulo,
      aditivos: copia(e.aditivos).sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero)),
      responsaveis: responsaveisDe(e),
      prazo: calcularPrazo(campos, e.aditivos),
      faltando: calcularFaltando(campos, e.responsaveis.length),
    }
  }
  const etapaDe = (o: ObraMemoria): EtapaMemoria => etapas.find((e) => e.id === o.etapa_id)!

  /** A mesma remoção de `admin_excluir_obra` (dados e arquivos), com o registro em `obra_excluida`. */
  function removerObra(o: ObraMemoria, etapaNome: string | null): Exclusao {
    const resumo = resumoDe(o)
    obras.splice(obras.indexOf(o), 1)
    plantaPorObra.delete(o.id)
    modelosPorObra.delete(o.id)
    const removidos: Record<BucketObra, number> = { fotos: 0, plantas: 0, originais: 0, modelos: 0 }
    for (const k of [...arquivos.keys()]) {
      const [bucket, obraId] = k.split('/')
      if (obraId !== o.id) continue
      arquivos.delete(k)
      removidos[bucket as BucketObra]++
    }
    for (let i = publicacoes.length - 1; i >= 0; i--) if (publicacoes[i].obra_id === o.id) publicacoes.splice(i, 1)
    for (let i = historicoModelos.length - 1; i >= 0; i--) if (historicoModelos[i].obra_id === o.id) historicoModelos.splice(i, 1)
    const agora = new Date().toISOString()
    const exclusao: Exclusao = {
      id: `exclusao-${++sequencia}`,
      obra_id: o.id,
      slug: o.slug,
      nome: o.nome,
      excluida_em: agora,
      excluida_por_nome: VOCE.nome,
      resumo,
      arquivos_removidos_em: agora,
      arquivos_removidos: removidos,
      arquivos_erro: null,
      etapa_nome: etapaNome,
    }
    exclusoes.unshift(exclusao)
    return exclusao
  }

  const nomeDe = (id: string | null) => USUARIOS_BASE.find((u) => u.id === id)?.nome ?? null
  const ordenarPavs = (o: ObraMemoria) =>
    [...o.pavimentos].sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo))

  return {
    async estadoSessao(): Promise<EstadoSessao> {
      if (!sessao) return { tipo: 'sem_sessao' }
      const usuario = { id: VOCE.id, nome: VOCE.nome }
      return admins.has(VOCE.id) ? { tipo: 'admin', usuario } : { tipo: 'negado', usuario }
    },

    async entrarComToken(token) {
      if (token !== 'fixture') {
        throw new ErroAdmin('Link inválido, expirado ou já usado. Peça outro pelo botão Administração no Mini App.')
      }
      sessao = true
    },

    async entrarComWidget() {
      if (!admins.has(VOCE.id)) throw new ErroAdmin('Esta conta do Telegram não é admin do Mini App.')
      sessao = true
    },

    async entrarModoTeste() {
      sessao = true
    },

    async sair() {
      sessao = false
    },

    async listarEtapas(): Promise<EtapaLista[]> {
      exigirAdmin()
      return [...etapas]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
        .map((e) => {
          const daEtapa = obras.filter((o) => o.etapa_id === e.id)
          return {
            id: e.id,
            slug: e.slug,
            nome: e.nome,
            ordem: e.ordem,
            arquivada_em: e.arquivada_em,
            telegram_vinculado: e.telegram_chat_id !== null,
            telegram_chat_titulo: e.telegram_chat_titulo,
            obras: daEtapa.length,
            obras_arquivadas: daEtapa.filter((o) => o.arquivada_em).length,
            sigla: e.sigla,
            faltando: calcularFaltando(camposDe(e), e.responsaveis.length).length,
          }
        })
    },

    async salvarEtapa(d) {
      exigirAdmin()
      const nome = (d.nome ?? '').trim()
      if (!nome || nome.length > 120) throw new ErroAdmin('Informe o nome da etapa (até 120 caracteres)')
      if (!Number.isInteger(d.ordem)) throw new ErroAdmin('O campo ordem precisa ser um número inteiro')
      if (d.id) {
        const e = etapas.find((x) => x.id === d.id)
        if (!e) throw new ErroAdmin('Etapa não encontrada')
        const campos = aplicarCampos(
          camposDe(e),
          d,
          etapas.filter((x) => x !== e && x.sigla !== null).map((x) => x.sigla as string),
        )
        e.nome = nome
        e.ordem = d.ordem
        Object.assign(e, campos)
        return detalheDe(e)
      }
      const slug = d.slug ?? ''
      if (!SLUG.test(slug) || slug.length > 40) {
        throw new ErroAdmin('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)')
      }
      if (etapas.some((x) => x.slug === slug)) throw new ErroAdmin(`Já existe uma etapa com o slug ${slug}`)
      const campos = aplicarCampos(
        null,
        d,
        etapas.filter((x) => x.sigla !== null).map((x) => x.sigla as string),
      )
      const nova: EtapaMemoria = {
        ...campos,
        id: `etapa-nova-${++sequencia}`,
        slug,
        nome,
        ordem: d.ordem,
        telegram_chat_id: null,
        telegram_chat_titulo: null,
        arquivada_em: null,
        aditivos: [],
        responsaveis: [],
      }
      etapas.push(nova)
      return detalheDe(nova)
    },

    async obterEtapa(slug) {
      exigirAdmin()
      return detalheDe(etapaPorSlug(slug))
    },

    async salvarAditivo(d) {
      exigirAdmin()
      const e = etapas.find((x) => x.id === d.etapa_id)
      if (!e) throw new ErroAdmin('Etapa não encontrada')
      const numero = (d.numero ?? '').trim()
      if (!numero || numero.length > 40) throw new ErroAdmin('Informe o número do aditivo (até 40 caracteres)')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data ?? '') || Number.isNaN(Date.parse(d.data))) {
        throw new ErroAdmin('Data do aditivo inválida: use AAAA-MM-DD')
      }
      if (!Number.isInteger(d.prazo_dias)) throw new ErroAdmin('O prazo do aditivo precisa ser um número inteiro de dias')
      if (!Number.isFinite(d.valor)) throw new ErroAdmin('O valor do aditivo precisa ser um número')
      const descricao = (d.descricao ?? '').trim() || null
      if (descricao && descricao.length > 300) throw new ErroAdmin('A descrição do aditivo pode ter até 300 caracteres')
      if (e.aditivos.some((a) => a.numero === numero && a.id !== d.id)) {
        throw new ErroAdmin(`Já existe o aditivo ${numero} nesta etapa`)
      }
      const valor = Math.round(d.valor * 100) / 100
      if (d.id) {
        const atual = e.aditivos.find((a) => a.id === d.id)
        if (!atual) throw new ErroAdmin('Aditivo não encontrado')
        Object.assign(atual, { numero, data: d.data, prazo_dias: d.prazo_dias, valor, descricao })
        return copia(atual)
      }
      const novo: Aditivo = { id: `aditivo-novo-${++sequencia}`, etapa_id: e.id, numero, data: d.data, prazo_dias: d.prazo_dias, valor, descricao }
      e.aditivos.push(novo)
      return copia(novo)
    },

    async removerAditivo(id) {
      exigirAdmin()
      for (const e of etapas) {
        const i = e.aditivos.findIndex((a) => a.id === id)
        if (i >= 0) {
          e.aditivos.splice(i, 1)
          return
        }
      }
      throw new ErroAdmin('Aditivo não encontrado')
    },

    async definirResponsaveis(etapaId, lista) {
      exigirAdmin()
      const e = etapas.find((x) => x.id === etapaId)
      if (!e) throw new ErroAdmin('Etapa não encontrada')
      const vistos = new Set<string>()
      const nova = lista.map((r) => {
        if (vistos.has(r.usuario_id)) throw new ErroAdmin('Responsável repetido na lista')
        vistos.add(r.usuario_id)
        if (!USUARIOS_BASE.some((u) => u.id === r.usuario_id)) throw new ErroAdmin('Usuário não encontrado')
        const funcao = (r.funcao ?? '').trim() || 'Fiscal'
        if (funcao.length > 60) throw new ErroAdmin('A função pode ter até 60 caracteres')
        return { usuario_id: r.usuario_id, funcao }
      })
      e.responsaveis = nova
      return responsaveisDe(e)
    },

    async listarBoletins(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const ordem = (a: { data: string; revisao: number }, b: { data: string; revisao: number }) =>
        b.data.localeCompare(a.data) || b.revisao - a.revisao
      return {
        boletins: boletins
          .filter((x) => x.etapa_id === e.id)
          .map(semEtapa)
          .sort(ordem),
        pedidos: pedidos
          .filter((x) => x.etapa_id === e.id && x.estado !== 'emitido')
          .map(semEtapa)
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
      const agora = new Date().toISOString()
      // Um pedido que falhou para a mesma revisão volta para a fila.
      const antigo = pedidos.find((p) => p.etapa_id === e.id && p.data === data && p.revisao === revisao)
      if (antigo) {
        Object.assign(antigo, { estado: 'pendente', tentativas: 0, erro: null, atualizado_em: agora })
        return semEtapa(antigo)
      }
      const novo = { id: ++sequenciaPedido, etapa_id: e.id, data, revisao, estado: 'pendente' as const, tentativas: 0, erro: null, atualizado_em: agora }
      pedidos.push(novo)
      return semEtapa(novo)
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

    async listarPessoas(): Promise<Pessoa[]> {
      exigirAdmin()
      return USUARIOS_BASE.map((u) => ({
        id: u.id,
        nome: u.nome,
        nome_exibicao: nomeExibicao(u.id),
        username: u.username,
        telegram_id: u.telegram_id,
        eh_admin: admins.has(u.id),
        participacoes: participantes
          .filter((p) => p.usuario_id === u.id)
          .map((p) => {
            const o = obras.find((x) => x.id === p.obra_id)!
            return { obra_slug: o.slug, obra_nome: o.nome, etapa_nome: etapaDe(o).nome, papel: p.papel }
          }),
      })).sort((a, b) => (a.nome_exibicao ?? a.nome).localeCompare(b.nome_exibicao ?? b.nome))
    },

    async definirNomeExibicao(usuarioId, nome) {
      exigirAdmin()
      const u = USUARIOS_BASE.find((x) => x.id === usuarioId)
      if (!u) throw new ErroAdmin('Usuário não encontrado')
      const limpo = (nome ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
      if (limpo.length > 60) throw new ErroAdmin('O nome de exibição pode ter até 60 caracteres')
      nomesExibicao.set(usuarioId, limpo || null)
      return { id: u.id, nome: u.nome, nome_exibicao: limpo || null }
    },

    async arquivarEtapa(slug, arquivada) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      e.arquivada_em = arquivada ? (e.arquivada_em ?? new Date().toISOString()) : null
      return e.arquivada_em
    },

    async desvincularEtapa(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      e.telegram_chat_id = null
      e.telegram_chat_titulo = null
      for (const o of obras) if (o.etapa_id === e.id) o.telegram_chat_id = null
    },

    async resumoEtapa(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const daEtapa = [...obras]
        .filter((o) => o.etapa_id === e.id)
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
      const total: ResumoObra = {
        registros: 0,
        fotos: 0,
        ambientes: 0,
        pavimentos: 0,
        plantas: 0,
        modelos: 0,
        participantes: 0,
        publicacoes_telegram: 0,
        arquivos: { fotos: 0, plantas: 0, originais: 0, modelos: 0 },
      }
      for (const o of daEtapa) {
        const r = resumoDe(o)
        for (const k of Object.keys(r) as (keyof ResumoObra)[]) {
          if (k === 'arquivos') {
            for (const b of Object.keys(r.arquivos) as BucketObra[]) total.arquivos[b] += r.arquivos[b]
          } else total[k] += r[k]
        }
      }
      return { obras: daEtapa.map((o) => ({ slug: o.slug, nome: o.nome })), total }
    },

    async excluirEtapa(slug, confirmacao) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      if ((confirmacao ?? '').trim() !== e.nome) {
        throw new ErroAdmin(`Para excluir, digite exatamente o nome da etapa: ${e.nome}`)
      }
      const feitas = obras.filter((o) => o.etapa_id === e.id).map((o) => removerObra(o, e.nome))
      etapas.splice(etapas.indexOf(e), 1)
      // Como `admin_excluir_etapa`: os boletins (e os pedidos) da etapa saem antes.
      for (const lista of [boletins, pedidos] as { etapa_id: string }[][]) {
        for (let i = lista.length - 1; i >= 0; i--) if (lista[i].etapa_id === e.id) lista.splice(i, 1)
      }
      return {
        exclusoes: feitas.map((x) => ({
          exclusao_id: x.id,
          removidos: x.arquivos_removidos ?? {},
          pendente: false,
          erro: null,
        })),
        pendente: false,
        erro: null,
      }
    },

    async obterOrganizacao() {
      // Como a RPC `organizacao()`: também sem sessão (tela de entrada).
      return organizacaoAtual()
    },

    async salvarOrganizacao(d) {
      exigirAdmin()
      const nome = (d.nome ?? '').trim()
      if (!nome || nome.length > NOME_OM_MAX) throw new ErroAdmin(`Informe o nome da OM (até ${NOME_OM_MAX} caracteres)`)
      if (d.logo_path !== null) {
        if (!CAMINHO_LOGO.test(d.logo_path)) throw new ErroAdmin('Caminho do logo inválido')
        if (!logos.has(d.logo_path)) throw new ErroAdmin('Logo não encontrado no Storage: envie o arquivo antes de salvar')
      }
      let cabecalho = organizacao.cabecalho
      if (d.cabecalho !== undefined) {
        if (d.cabecalho.length > CABECALHO_LINHAS_MAX) {
          throw new ErroAdmin(`O cabeçalho pode ter até ${CABECALHO_LINHAS_MAX} linhas`)
        }
        cabecalho = d.cabecalho.map((l) => l.trim())
        if (cabecalho.some((l) => l.length < 1 || l.length > CABECALHO_LINHA_MAX)) {
          throw new ErroAdmin(`Cada linha do cabeçalho precisa ter de 1 a ${CABECALHO_LINHA_MAX} caracteres`)
        }
      }
      organizacao.nome = nome
      organizacao.logo_path = d.logo_path
      organizacao.cabecalho = cabecalho
      return organizacaoAtual()
    },

    async enviarLogo(arquivo) {
      exigirAdmin()
      const problema = problemaDoLogo(arquivo)
      if (problema) throw new ErroAdmin(problema)
      const caminho = novoCaminhoLogo(arquivo.type)
      logos.set(caminho, await dataUrl(arquivo))
      return caminho
    },

    async listarObras(): Promise<ObraLista[]> {
      exigirAdmin()
      return [...obras]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
        .map((o) => ({
          id: o.id,
          slug: o.slug,
          nome: o.nome,
          ordem: o.ordem,
          pavimentos: ordenarPavs(o).map(({ codigo, nome, ordem }) => ({ codigo, nome, ordem })),
          ambientes_ativos: o.pavimentos.reduce((s, p) => s + p.ambientes, 0),
          status: typeof o.config?.status === 'string' ? o.config.status : null,
          config_atualizada_em: o.config_atualizada_em,
          arquivada_em: o.arquivada_em,
          etapa_id: o.etapa_id,
          etapa_slug: etapaDe(o).slug,
          etapa_nome: etapaDe(o).nome,
          etapa_arquivada_em: etapaDe(o).arquivada_em,
        }))
    },

    async obterObra(slug): Promise<ObraAdmin> {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const e = etapaDe(o)
      return copia({
        obra: {
          id: o.id,
          slug: o.slug,
          nome: o.nome,
          ordem: o.ordem,
          telegram_vinculado: o.telegram_chat_id !== null,
          arquivada_em: o.arquivada_em,
          etapa: {
            id: e.id,
            slug: e.slug,
            nome: e.nome,
            arquivada_em: e.arquivada_em,
            telegram_vinculado: e.telegram_chat_id !== null,
          },
        },
        pavimentos: ordenarPavs(o).map(
          (p): PavimentoAdmin => ({ ...p, ambientes_ativos: p.ambientes, plantas: p.ambientes > 0 ? 1 : 0 }),
        ),
        config: o.config,
        config_atualizada_em: o.config_atualizada_em,
        config_atualizada_por: o.config_atualizada_por,
      })
    },

    async salvarObra(d) {
      exigirAdmin()
      const nome = (d.nome ?? '').trim()
      if (!nome || nome.length > 120) throw new ErroAdmin('Informe o nome da obra (até 120 caracteres)')
      if (!Number.isInteger(d.ordem)) throw new ErroAdmin('O campo ordem precisa ser um número inteiro')
      const destino = d.etapa_id === undefined ? null : etapas.find((e) => e.id === d.etapa_id)
      if (destino === undefined) throw new ErroAdmin('Etapa não encontrada')
      if (d.id) {
        const o = obras.find((x) => x.id === d.id)
        if (!o) throw new ErroAdmin('Obra não encontrada')
        if (d.slug && d.slug !== o.slug) throw new ErroAdmin('O slug não pode ser alterado depois de criado')
        o.nome = nome
        o.ordem = d.ordem
        if (destino && destino.id !== o.etapa_id) {
          o.etapa_id = destino.id
          // Grupo diferente: o tópico vinculado não vale mais.
          if (o.telegram_chat_id !== destino.telegram_chat_id) o.telegram_chat_id = null
        }
        return { id: o.id, slug: o.slug, nome: o.nome, ordem: o.ordem }
      }
      const slug = d.slug ?? ''
      if (!SLUG.test(slug) || slug.length > 40) {
        throw new ErroAdmin('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)')
      }
      if (obras.some((x) => x.slug === slug)) throw new ErroAdmin(`Já existe uma obra com o slug ${slug}`)
      if (!destino) throw new ErroAdmin('Escolha a etapa da obra')
      const nova: ObraMemoria = {
        id: `obra-nova-${++sequencia}`,
        slug,
        nome,
        ordem: d.ordem,
        pavimentos: [],
        config: null,
        config_atualizada_em: null,
        config_atualizada_por: null,
        arquivada_em: null,
        etapa_id: destino.id,
        telegram_chat_id: null,
      }
      obras.push(nova)
      return { id: nova.id, slug, nome, ordem: nova.ordem }
    },

    async salvarPavimentos(slug, lista) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const vistos = new Set<string>()
      for (const p of lista) {
        if (!CODIGO.test(p.codigo) || p.codigo.length > 30) {
          throw new ErroAdmin(`Código de pavimento inválido: ${p.codigo}. Use letras minúsculas, dígitos e hífen (até 30)`)
        }
        if (!p.nome.trim() || p.nome.length > 80) {
          throw new ErroAdmin(`Informe o nome do pavimento ${p.codigo} (até 80 caracteres)`)
        }
        if (vistos.has(p.codigo)) throw new ErroAdmin(`Código de pavimento repetido: ${p.codigo}`)
        vistos.add(p.codigo)
      }
      const bloqueados = o.pavimentos.filter((p) => !vistos.has(p.codigo) && p.ambientes > 0)
      if (bloqueados.length > 0) {
        throw new ErroAdmin(
          `Não é possível apagar pavimento com ambientes ou plantas: ${bloqueados.map((p) => p.codigo).join(', ')}`,
        )
      }
      o.pavimentos = lista.map((p, i) => {
        const atual = o.pavimentos.find((x) => x.codigo === p.codigo)
        return {
          id: atual?.id ?? `${slug}-${p.codigo}`,
          codigo: p.codigo,
          nome: p.nome.trim(),
          ordem: Number.isInteger(p.ordem) ? p.ordem : i + 1,
          ambientes: atual?.ambientes ?? 0,
        }
      })
      return ordenarPavs(o).map(({ codigo, nome, ordem }) => ({ codigo, nome, ordem }))
    },

    async salvarConfig(slug, config) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        throw new ErroAdmin('A configuração precisa ser um objeto JSON')
      }
      if (config.status !== undefined && config.status !== 'revisado' && config.status !== 'aguardando_revisao_humana') {
        throw new ErroAdmin('Status inválido: use aguardando_revisao_humana ou revisado')
      }
      o.config = copia(config)
      o.config_atualizada_em = new Date().toISOString()
      o.config_atualizada_por = VOCE.nome
    },

    async exportarObra(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return {
        formato: 'miniappcofz-obra',
        versao: 1,
        exportado_em: new Date().toISOString(),
        obra: { slug: o.slug, nome: o.nome, ordem: o.ordem },
        pavimentos: ordenarPavs(o).map(({ codigo, nome, ordem }) => ({ codigo, nome, ordem })),
        config: copia(o.config),
        ambientes: [],
        plantas: [],
      }
    },

    async obterEditorPlanta(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const planta = plantaDe(o)
      const ordemPav = new Map(o.pavimentos.map((p) => [p.codigo, p.ordem]))
      return copia({
        obra: { id: o.id, slug: o.slug, nome: o.nome },
        config: o.config,
        config_atualizada_em: o.config_atualizada_em,
        pavimentos: ordenarPavs(o).map((p) => {
          const ultimo = publicacoes.find((x) => x.obra_id === o.id && x.pavimento === p.codigo)
          return {
            codigo: p.codigo,
            nome: p.nome,
            ordem: p.ordem,
            planta: planta.plantas.get(p.codigo) ?? null,
            ultimo_pdf: ultimo
              ? {
                  path: ultimo.pdf_path,
                  sha256: ultimo.pdf_sha256,
                  nome: ultimo.pdf_nome,
                  pagina: ultimo.pagina,
                  revisao: ultimo.revisao,
                  publicado_em: ultimo.publicado_em,
                }
              : null,
          }
        }),
        ambientes: [...planta.ambientes].sort(
          (a, b) => (ordemPav.get(a.pavimento) ?? 0) - (ordemPav.get(b.pavimento) ?? 0) || a.ordem - b.ordem,
        ),
      })
    },

    async listarPublicacoes(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia(publicacoes.filter((p) => p.obra_id === o.id).map((p) => ({ ...p, obra_id: undefined })))
    },

    async enviarArquivo(bucket, caminho, arquivo) {
      exigirAdmin()
      const obraId = caminho.split('/')[0]
      if (!obras.some((o) => o.id === obraId)) throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`)
      if (bucket === 'originais' && !/\.pdf$/.test(caminho)) throw new ErroAdmin('O bucket originais só aceita PDF.')
      // Como as políticas `modelos_admin_*`: <obra_id>/<SIGLA>/<hash16>.frag.
      if (bucket === 'modelos' && !/^[^/]+\/[A-Z]{2,4}\/[0-9a-f]{16}\.frag$/.test(caminho)) {
        throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`)
      }
      // Como o Storage (allowed_mime_types): o bucket plantas só aceita WebP, e aqui conferimos os bytes.
      if (bucket === 'plantas' && !ehWebp(new Uint8Array(await arquivo.slice(0, 12).arrayBuffer()))) {
        throw new ErroAdmin(`O arquivo ${caminho} não é WebP.`)
      }
      arquivos.set(`${bucket}/${caminho}`, arquivo)
    },

    async arquivarObra(slug, arquivada) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      o.arquivada_em = arquivada ? (o.arquivada_em ?? new Date().toISOString()) : null
      return o.arquivada_em
    },

    async resumoObra(slug) {
      exigirAdmin()
      return resumoDe(obraPorSlug(slug))
    },

    async excluirObra(slug, confirmacao) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if ((confirmacao ?? '').trim() !== o.nome) {
        throw new ErroAdmin(`Para excluir, digite exatamente o nome da obra: ${o.nome}`)
      }
      const exclusao = removerObra(o, null)
      return { exclusao_id: exclusao.id, obra_id: o.id, arquivos_removidos: exclusao.arquivos_removidos ?? {}, pendente: false }
    },

    async listarExclusoes() {
      exigirAdmin()
      return copia(exclusoes)
    },

    async limparExclusao(id) {
      exigirAdmin()
      const e = exclusoes.find((x) => x.id === id)
      if (!e) throw new ErroAdmin('Exclusão não encontrada')
      e.arquivos_removidos_em = new Date().toISOString()
      e.arquivos_erro = null
      return { exclusao_id: e.id, obra_id: e.obra_id, arquivos_removidos: e.arquivos_removidos ?? {}, pendente: false }
    },

    async listarModelosAdmin(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia({
        modelos: [...(modelosPorObra.get(o.id) ?? [])].sort((a, b) => a.sigla.localeCompare(b.sigla)),
        historico: historicoModelos.filter((h) => h.obra_id === o.id).map((h) => ({ ...h, obra_id: undefined })),
      })
    },

    async registrarModelo(slug, r) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if (!/^[A-Z]{2,4}$/.test(r.sigla)) throw new ErroAdmin('Sigla inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ).')
      if (r.caminho !== `${o.id}/${r.sigla}/${r.hash}.frag`) throw new ErroAdmin('Caminho do modelo não confere.')
      const arq = arquivos.get(`modelos/${r.caminho}`)
      if (!arq) throw new ErroAdmin(`Modelo não encontrado no Storage (modelos/${r.caminho}): envie o arquivo antes de registrar.`)
      if (arq.size !== r.bytes) throw new ErroAdmin(`O arquivo no Storage tem ${arq.size} bytes, e não ${r.bytes}.`)
      const agora = new Date().toISOString()
      const modelo: ModeloAdmin = {
        sigla: r.sigla,
        revisao: r.revisao,
        caminho: r.caminho,
        bytes: r.bytes,
        hash: r.hash,
        atualizado_em: agora,
      }
      modelosPorObra.set(o.id, [...(modelosPorObra.get(o.id) ?? []).filter((m) => m.sigla !== r.sigla), modelo])
      historicoModelos.unshift({
        obra_id: o.id,
        id: `pubmod-${++sequencia}`,
        acao: 'publicado',
        sigla: r.sigla,
        revisao: r.revisao,
        bytes: r.bytes,
        hash: r.hash,
        origem: r.origem,
        arquivo_nome: r.arquivo_nome ?? null,
        ifc_bytes: r.ifc_bytes ?? null,
        publicado_em: agora,
        publicado_por_nome: VOCE.nome,
      })
      return copia(modelo)
    },

    async retirarModelo(slug, sigla) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const lista = modelosPorObra.get(o.id) ?? []
      const m = lista.find((x) => x.sigla === sigla)
      if (!m) throw new ErroAdmin(`Não há modelo publicado com a sigla ${sigla} nesta obra.`)
      modelosPorObra.set(
        o.id,
        lista.filter((x) => x.sigla !== sigla),
      )
      historicoModelos.unshift({
        obra_id: o.id,
        id: `pubmod-${++sequencia}`,
        acao: 'retirado',
        sigla,
        revisao: m.revisao,
        bytes: m.bytes,
        hash: m.hash,
        origem: null,
        arquivo_nome: null,
        ifc_bytes: null,
        publicado_em: new Date().toISOString(),
        publicado_por_nome: VOCE.nome,
      })
    },

    async listarRA(obraId) {
      exigirAdmin()
      return copia(geometriaPorObra.get(obraId) ?? [])
    },

    async definirQr(ambienteId, qr: QrAmbiente) {
      exigirAdmin()
      const a = [...geometriaPorObra.values()].flat().find((x) => x.ambiente_id === ambienteId)
      if (!a) throw new ErroAdmin('Ambiente sem geometria.')
      const n = a.contorno.length
      if (!Number.isInteger(qr.parede) || qr.parede < 0 || qr.parede >= n) {
        throw new ErroAdmin(`Parede inválida: use de 1 a ${n}.`)
      }
      const [x0, z0] = a.contorno[qr.parede]
      const [x1, z1] = a.contorno[(qr.parede + 1) % n]
      const comprimento = Math.hypot(x1 - x0, z1 - z0)
      if (!(qr.distancia_m >= 0 && qr.distancia_m <= comprimento)) {
        throw new ErroAdmin('A distância precisa estar entre 0 e o comprimento da parede.')
      }
      if (!(qr.altura_m >= 0 && qr.altura_m <= 5)) throw new ErroAdmin('A altura precisa estar entre 0 e 5 m.')
      if (!(qr.lado_m >= 0.05 && qr.lado_m <= 1)) throw new ErroAdmin('O lado precisa estar entre 5 e 100 cm.')
      a.qr = { ...qr }
    },

    async removerQr(ambienteId) {
      exigirAdmin()
      const a = [...geometriaPorObra.values()].flat().find((x) => x.ambiente_id === ambienteId)
      if (!a) throw new ErroAdmin('Ambiente sem geometria.')
      a.qr = null
    },

    async baixarOriginal(caminho) {
      exigirAdmin()
      const b = arquivos.get(`originais/${caminho}`)
      if (!b) throw new ErroAdmin('Não foi possível baixar o PDF guardado.')
      return new Uint8Array(await b.arrayBuffer())
    },

    async publicarRevisao(slug, payload) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const p = payload as {
        pavimentos: {
          codigo: string
          revisao: string
          pdf: { path: string; sha256: string; nome: string; pagina: number }
          pagina_pt: [number, number]
          recorte_pt: [number, number, number, number]
          detalhes: Record<string, unknown>
          resumo?: Record<string, unknown>
        }[]
        ambientes: Omit<AmbienteBanco, 'ordem' | 'ativo' | 'revisao_planta'>[]
        ambientes_removidos?: string[]
        config?: ConfigObra
        config_atualizada_em?: string | null
      }
      if (p.config && (p.config_atualizada_em ?? null) !== o.config_atualizada_em) {
        throw new ErroAdmin('A configuração da obra foi alterada por outra pessoa. Recarregue a página e confira antes de publicar.')
      }
      for (const pav of p.pavimentos) {
        if (!o.pavimentos.some((x) => x.codigo === pav.codigo)) throw new ErroAdmin(`Pavimento não encontrado na obra: ${pav.codigo}`)
        if (!arquivos.has(`originais/${pav.pdf.path}`)) {
          throw new ErroAdmin(`PDF não encontrado no Storage (originais/${pav.pdf.path}): envie o arquivo antes de publicar`)
        }
        const base = `plantas/${o.id}/${pav.revisao}/${pav.codigo}/`
        const faltando = ['planta.webp', 'planta-hd.webp', ...Object.keys(pav.detalhes).map((c) => `ambientes/${c}.webp`)]
          .filter((n) => !arquivos.has(base + n))
        if (faltando.length) throw new ErroAdmin(`Imagens não encontradas no Storage (plantas): ${faltando.join(', ')}`)
      }
      const codigos = new Set(p.ambientes.map((a) => a.codigo))
      for (const a of p.ambientes) {
        if (!p.pavimentos.some((x) => x.codigo === a.pavimento && a.codigo in x.detalhes)) {
          throw new ErroAdmin(`Falta o detalhe (recorte) do ambiente ${a.codigo}`)
        }
      }
      const planta = plantaDe(o)
      const revisaoDe = new Map(p.pavimentos.map((x) => [x.codigo, x.revisao]))
      p.ambientes.forEach((a, i) => {
        const novo: AmbienteBanco = { ...copia(a), revisao_planta: revisaoDe.get(a.pavimento) ?? null, ordem: i + 1, ativo: true }
        const k = planta.ambientes.findIndex((x) => x.codigo === a.codigo)
        if (k >= 0) planta.ambientes[k] = novo
        else planta.ambientes.push(novo)
      })
      let inativados = 0
      const removidos = new Set(p.ambientes_removidos ?? [])
      for (const a of planta.ambientes) {
        if (a.ativo && (removidos.has(a.codigo) || (revisaoDe.has(a.pavimento) && !codigos.has(a.codigo)))) {
          a.ativo = false
          inativados++
        }
      }
      const ordemPav = new Map(o.pavimentos.map((x) => [x.codigo, x.ordem]))
      planta.ambientes
        .filter((a) => a.ativo)
        .sort((a, b) => (ordemPav.get(a.pavimento) ?? 0) - (ordemPav.get(b.pavimento) ?? 0) || a.ordem - b.ordem)
        .forEach((a, i) => {
          a.ordem = i + 1
        })
      const agora = new Date().toISOString()
      const feitas = p.pavimentos.map((pav) => {
        planta.plantas.set(pav.codigo, {
          revisao: pav.revisao,
          pdf_sha256: pav.pdf.sha256,
          pagina_pt: pav.pagina_pt,
          recorte_pt: pav.recorte_pt,
          criado_em: agora,
        })
        const pv = o.pavimentos.find((x) => x.codigo === pav.codigo)!
        pv.ambientes = planta.ambientes.filter((a) => a.ativo && a.pavimento === pav.codigo).length
        const id = `publicacao-${++sequencia}`
        publicacoes.unshift({
          id,
          obra_id: o.id,
          pavimento: pav.codigo,
          pavimento_nome: pv.nome,
          revisao: pav.revisao,
          publicado_em: agora,
          publicado_por_nome: VOCE.nome,
          pdf_path: pav.pdf.path,
          pdf_sha256: pav.pdf.sha256,
          pdf_nome: pav.pdf.nome,
          pagina: pav.pdf.pagina,
          resumo: { ...(pav.resumo ?? {}), ambientes: p.ambientes.filter((a) => a.pavimento === pav.codigo).length },
        })
        return { id, pavimento: pav.codigo, revisao: pav.revisao }
      })
      if (p.config) {
        o.config = { ...copia(p.config), status: 'aguardando_revisao_humana' }
        o.config_atualizada_em = agora
        o.config_atualizada_por = VOCE.nome
      }
      return { publicacoes: feitas, ambientes_ativos: planta.ambientes.filter((a) => a.ativo).length, inativados }
    },

    async listarAdmins(): Promise<Admin[]> {
      exigirAdmin()
      return USUARIOS_BASE.filter((u) => admins.has(u.id))
        .map((u) => {
          const a = admins.get(u.id)!
          return {
            usuario_id: u.id,
            nome: u.nome,
            username: u.username,
            telegram_id: u.telegram_id,
            criado_em: a.criado_em,
            criado_por_nome: nomeDe(a.criado_por),
          }
        })
        .sort((a, b) => a.nome.localeCompare(b.nome))
    },

    async incluirAdmin(usuarioId) {
      exigirAdmin()
      if (!USUARIOS_BASE.some((u) => u.id === usuarioId)) throw new ErroAdmin('Usuário não encontrado')
      if (!admins.has(usuarioId)) admins.set(usuarioId, { criado_em: new Date().toISOString(), criado_por: VOCE.id })
    },

    async removerAdmin(usuarioId) {
      exigirAdmin()
      if (!admins.has(usuarioId)) throw new ErroAdmin('Este usuário não é admin')
      if (admins.size <= 1) throw new ErroAdmin('Não é possível remover o último admin')
      admins.delete(usuarioId)
    },

    async listarUsuarios() {
      exigirAdmin()
      return USUARIOS_BASE.map((u) => ({ ...u, eh_admin: admins.has(u.id) })).sort((a, b) =>
        a.nome.localeCompare(b.nome),
      )
    },
  }
}
