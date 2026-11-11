/**
 * Repositório de teste do site de administração (VITE_DADOS=fixture): HTO e COFZ com a
 * configuração real de `data/<slug>/obra.json`, tudo em memória. Reproduz as regras das
 * RPCs (slug, pavimento com ambientes, último admin). Nunca entra no build de produção.
 */
import ambientesCofz from '../../../../data/cofz/ambientes.json'
import obraCofz from '../../../../data/cofz/obra.json'
import ambientesHto from '../../../../data/hto/ambientes.json'
import obraHto from '../../../../data/hto/obra.json'
import type { RepositorioAdmin } from './repositorio.ts'
import {
  ErroAdmin,
  type Admin,
  type ConfigObra,
  type EstadoSessao,
  type ObraAdmin,
  type ObraLista,
  type PavimentoAdmin,
  type PavimentoResumo,
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
  ambientes: { pavimento: string }[]
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
        }))
    },

    async obterObra(slug): Promise<ObraAdmin> {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia({
        obra: { id: o.id, slug: o.slug, nome: o.nome, ordem: o.ordem, telegram_vinculado: false },
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
