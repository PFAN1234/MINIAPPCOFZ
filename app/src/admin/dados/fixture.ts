/**
 * Repositório de teste do site de administração (VITE_DADOS=fixture): HTO e COFZ com a
 * configuração real de `data/<slug>/obra.json`, tudo em memória. Reproduz as regras das
 * RPCs (slug, pavimento com ambientes, último admin). Nunca entra no build de produção.
 */
import ambientesCofz from '../../../../data/cofz/ambientes.json'
import obraCofz from '../../../../data/cofz/obra.json'
import plantasCofz from '../../../../data/cofz/plantas.json'
import ambientesHto from '../../../../data/hto/ambientes.json'
import obraHto from '../../../../data/hto/obra.json'
import plantasHto from '../../../../data/hto/plantas.json'
import { ehWebp } from '../planta/render.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import {
  ErroAdmin,
  type Admin,
  type AmbienteBanco,
  type ConfigObra,
  type EstadoSessao,
  type BucketObra,
  type EventoModelo,
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
}

const VOCE: UsuarioApp = { id: 'usuario-teste', nome: 'Você (teste)', username: 'voce', telegram_id: 1, eh_admin: true }
const USUARIOS_BASE: Omit<UsuarioApp, 'eh_admin'>[] = [
  { id: VOCE.id, nome: VOCE.nome, username: VOCE.username, telegram_id: VOCE.telegram_id },
  { id: 'usuario-patricio', nome: 'Patrício Ferreira', username: null, telegram_id: 1362893349 },
  { id: 'usuario-eduardo', nome: 'Eduardo Lima', username: null, telegram_id: 669804829 },
  { id: 'usuario-maria', nome: 'Maria Souza', username: 'maria', telegram_id: 4242 },
]

function obraDoJson(id: string, ordem: number, json: ObraJson, ambientes: AmbientesJson): ObraMemoria {
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
  }
}

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function criarRepositorioAdminFixture(opcoes: { admin?: boolean; sessao?: boolean } = {}): RepositorioAdmin {
  const ehAdmin = opcoes.admin !== false
  let sessao = opcoes.sessao !== false
  const obras: ObraMemoria[] = [
    obraDoJson('obra-hto', 0, obraHto as unknown as ObraJson, ambientesHto as unknown as AmbientesJson),
    obraDoJson('obra-cofz', 1, obraCofz as unknown as ObraJson, ambientesCofz as unknown as AmbientesJson),
  ]
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
        }))
    },

    async obterObra(slug): Promise<ObraAdmin> {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia({
        obra: { id: o.id, slug: o.slug, nome: o.nome, ordem: o.ordem, telegram_vinculado: false, arquivada_em: o.arquivada_em },
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
      if (d.id) {
        const o = obras.find((x) => x.id === d.id)
        if (!o) throw new ErroAdmin('Obra não encontrada')
        if (d.slug && d.slug !== o.slug) throw new ErroAdmin('O slug não pode ser alterado depois de criado')
        o.nome = nome
        o.ordem = d.ordem
        return { id: o.id, slug: o.slug, nome: o.nome, ordem: o.ordem }
      }
      const slug = d.slug ?? ''
      if (!SLUG.test(slug) || slug.length > 40) {
        throw new ErroAdmin('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)')
      }
      if (obras.some((x) => x.slug === slug)) throw new ErroAdmin(`Já existe uma obra com o slug ${slug}`)
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
      }
      exclusoes.unshift(exclusao)
      return { exclusao_id: exclusao.id, obra_id: o.id, arquivos_removidos: removidos, pendente: false }
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
