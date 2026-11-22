import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { ModelosRepositorio } from '../application/ports/ModelosRepositorio.port.ts'
import { SIGLA_VALIDA } from '../domain/modelos.ts'
import type { EventoModelo, ModeloAdmin, ObraCentral } from '../domain/tipos.ts'
import { baixarModeloLocal, listarModelosLocais } from './modelosLocais.ts'

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** O que o adaptador pede à fixture do admin (obras, Storage, sessão); o padrão basta para testes isolados. */
export interface DepsModelosFixture {
  /** Lança se não houver sessão de admin (as operações do admin chamam antes de tudo). */
  exigirAdmin?: () => void
  /** Obra do slug; lança se não existir. */
  obraPorSlug?: (slug: string) => { id: string }
  /** Obras da Central de modelos; o padrão traz a HTO e uma obra sem arquivos. */
  obras?: () => { id: string; slug: string; nome: string }[]
  /** Séries de documentos vigentes da obra (a Central conta); o padrão é 0. */
  documentos?: (obraId: string) => number
  /** Issues abertas da obra (a Central conta); o padrão é 0. */
  issuesAbertas?: (obraId: string) => number
  /** Tamanho do arquivo enviado ao bucket `modelos` (caminho dentro do bucket); `undefined` se não houver. */
  tamanhoArquivo?: (caminho: string) => number | undefined
  /** Numeração dos eventos do histórico (compartilhada com o resto da fixture, se houver). */
  proximoId?: () => number
  /** Quem aparece como autor das publicações. */
  nomeUsuario?: string
}

/** Além da porta, o que a fixture do admin usa para resumo e exclusão de obra. */
export interface ModelosFixture extends ModelosRepositorio {
  quantidade(obraId: string): number
  removerObra(obraId: string): void
}

/**
 * Adaptador de fixture dos modelos: o estado (publicados e histórico) é próprio de cada instância.
 * A lista do campo vem do manifesto em `public/modelos/<obra>/` (`listarModelosLocais`).
 */
export function criarModelosFixture(deps: DepsModelosFixture = {}): ModelosFixture {
  let contador = 0
  const {
    exigirAdmin = () => {},
    obraPorSlug = (slug) => ({ id: `obra-${slug}` }),
    obras = () => [
      { id: 'obra-hto', slug: 'hto', nome: 'HTO' },
      { id: 'obra-vazia', slug: 'vazia', nome: 'Obra sem arquivos' },
    ],
    documentos = () => 0,
    issuesAbertas = () => 0,
    tamanhoArquivo = () => undefined,
    proximoId = () => ++contador,
    nomeUsuario = 'Você',
  } = deps
  const modelosPorObra = new Map<string, ModeloAdmin[]>()
  const historico: (EventoModelo & { obra_id: string })[] = []

  return {
    listarModelos: listarModelosLocais,
    baixarModelo: baixarModeloLocal,

    async listarModelosAdmin(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia({
        modelos: [...(modelosPorObra.get(o.id) ?? [])].sort((a, b) => a.sigla.localeCompare(b.sigla)),
        historico: historico.filter((h) => h.obra_id === o.id).map((h) => ({ ...h, obra_id: undefined })),
      })
    },

    async listarObrasCentral() {
      exigirAdmin()
      return obras().map((o): ObraCentral => {
        const lista = modelosPorObra.get(o.id) ?? []
        const datas = historico.filter((h) => h.obra_id === o.id).map((h) => h.publicado_em)
        return {
          obra_id: o.id,
          slug: o.slug,
          nome: o.nome,
          disciplinas: lista.length,
          documentos: documentos(o.id),
          issues_abertas: issuesAbertas(o.id),
          atualizado_em: datas.length ? datas.sort().at(-1)! : null,
        }
      })
    },

    async registrarModelo(slug, r) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if (!SIGLA_VALIDA.test(r.sigla)) throw new ErroAdmin('Sigla inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ).')
      if (r.caminho !== `${o.id}/${r.sigla}/${r.hash}.frag`) throw new ErroAdmin('Caminho do modelo não confere.')
      const tamanho = tamanhoArquivo(r.caminho)
      if (tamanho === undefined) {
        throw new ErroAdmin(`Modelo não encontrado no Storage (modelos/${r.caminho}): envie o arquivo antes de registrar.`)
      }
      if (tamanho !== r.bytes) throw new ErroAdmin(`O arquivo no Storage tem ${tamanho} bytes, e não ${r.bytes}.`)
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
      historico.unshift({
        obra_id: o.id,
        id: `pubmod-${proximoId()}`,
        acao: 'publicado',
        sigla: r.sigla,
        revisao: r.revisao,
        bytes: r.bytes,
        hash: r.hash,
        origem: r.origem,
        arquivo_nome: r.arquivo_nome ?? null,
        ifc_bytes: r.ifc_bytes ?? null,
        publicado_em: agora,
        publicado_por_nome: nomeUsuario,
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
      historico.unshift({
        obra_id: o.id,
        id: `pubmod-${proximoId()}`,
        acao: 'retirado',
        sigla,
        revisao: m.revisao,
        bytes: m.bytes,
        hash: m.hash,
        origem: null,
        arquivo_nome: null,
        ifc_bytes: null,
        publicado_em: new Date().toISOString(),
        publicado_por_nome: nomeUsuario,
      })
    },

    quantidade: (obraId) => modelosPorObra.get(obraId)?.length ?? 0,

    removerObra(obraId) {
      modelosPorObra.delete(obraId)
      for (let i = historico.length - 1; i >= 0; i--) if (historico[i].obra_id === obraId) historico.splice(i, 1)
    },
  }
}
