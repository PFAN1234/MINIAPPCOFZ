import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocumentosRepositorio } from '../application/ports/DocumentosRepositorio.port.ts'
import type { Documento, RevisaoDocumento, TipoDocumento, VinculoDocumento } from '../domain/documentos.ts'

type Linha = Record<string, unknown>
type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

const texto = (v: unknown) => (v == null ? null : String(v))

function vinculo(l: Linha): VinculoDocumento {
  return {
    tipo: l.tipo === 'pavimento' ? 'pavimento' : 'elemento',
    sigla: String(l.sigla),
    globalId: String(l.global_id),
    classe: texto(l.classe),
    nome: texto(l.nome),
  }
}

function revisao(l: Linha) {
  return {
    id: String(l.id),
    serie: String(l.serie),
    codigo: texto(l.codigo),
    titulo: String(l.titulo),
    tipo: String(l.tipo) as TipoDocumento,
    disciplina: texto(l.disciplina),
    revisao: String(l.revisao),
    caminho: String(l.caminho),
    arquivoNome: String(l.arquivo_nome),
    mime: String(l.mime),
    bytes: Number(l.bytes),
    sha256: String(l.sha256),
    enviadoEm: String(l.enviado_em),
    enviadoPorNome: texto(l.enviado_por_nome),
  }
}

function documento(l: Linha): Documento {
  return {
    ...revisao(l),
    revisoes: Number(l.revisoes ?? 1),
    vinculos: ((l.vinculos as Linha[] | null) ?? []).map(vinculo),
  }
}

/** Adaptador Supabase dos documentos. `rpc` é a chamada admin (traduz os erros). */
export function criarDocumentosSupabase(cliente: SupabaseClient, rpc: Rpc): DocumentosRepositorio {
  return {
    async listarDocumentos(slug) {
      const d = await rpc<{ documentos?: Linha[] } | null>('admin_listar_documentos', { p_slug: slug })
      return (d?.documentos ?? []).map(documento)
    },

    async historicoDocumento(serie) {
      const linhas = await rpc<Linha[] | null>('admin_historico_documento', { p_serie: serie })
      return (linhas ?? []).map(
        (l): RevisaoDocumento => ({
          ...revisao(l),
          retiradoEm: texto(l.retirado_em),
          retiradoPorNome: texto(l.retirado_por_nome),
        }),
      )
    },

    async registrarDocumento(slug, r) {
      const d = await rpc<Linha>('admin_registrar_documento', {
        p_slug: slug,
        p: {
          serie: r.serie,
          codigo: r.codigo,
          titulo: r.titulo,
          tipo: r.tipo,
          disciplina: r.disciplina,
          revisao: r.revisao,
          caminho: r.caminho,
          arquivo_nome: r.arquivoNome,
          mime: r.mime,
          bytes: r.bytes,
          sha256: r.sha256,
        },
      })
      return documento(d)
    },

    async retirarDocumento(id) {
      await rpc('admin_retirar_documento', { p_id: id })
    },

    async vincularDocumento(id, vinculos) {
      const linhas = await rpc<Linha[] | null>('admin_vincular_documento', {
        p_id: id,
        p_vinculos: vinculos.map((v) => ({
          tipo: v.tipo,
          sigla: v.sigla,
          global_id: v.globalId,
          classe: v.classe ?? null,
          nome: v.nome ?? null,
        })),
      })
      return (linhas ?? []).map(vinculo)
    },

    async baixarDocumento(caminho) {
      const { data, error } = await cliente.storage.from('documentos').download(caminho)
      if (error || !data) throw new Error('Não foi possível baixar o documento guardado.', { cause: error })
      return data
    },
  }
}
