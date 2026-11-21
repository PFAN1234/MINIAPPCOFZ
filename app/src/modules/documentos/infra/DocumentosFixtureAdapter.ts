import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { DocumentosRepositorio } from '../application/ports/DocumentosRepositorio.port.ts'
import {
  caminhoDocumento,
  extensaoArquivo,
  problemaDocumento,
  type Documento,
  type RevisaoDocumento,
  type VinculoDocumento,
} from '../domain/documentos.ts'
import type { SementeDocumento } from './documentosSemente.ts'

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** O que o adaptador pede à fixture do admin (obras, Storage, sessão); o padrão basta para testes isolados. */
export interface DepsDocumentosFixture {
  /** Lança se não houver sessão de admin. */
  exigirAdmin?: () => void
  /** Obra do slug; lança se não existir. */
  obraPorSlug?: (slug: string) => { id: string }
  /** Tamanho do arquivo enviado ao bucket `documentos` (caminho dentro do bucket); `undefined` se não houver. */
  tamanhoArquivo?: (caminho: string) => number | undefined
  /** Conteúdo do arquivo enviado ao bucket `documentos`; `undefined` se não houver. */
  conteudoArquivo?: (caminho: string) => Blob | Uint8Array | undefined
  /** Numeração dos ids (compartilhada com o resto da fixture, se houver). */
  proximoId?: () => number
  /** Quem aparece como autor dos envios e retiradas. */
  nomeUsuario?: string
  /** Documentos que já existem ao criar a fixture (com o conteúdo, servido por `baixarDocumento`). */
  semente?: SementeDocumento[]
}

/** Além da porta, o que a fixture do admin usa para a Central de obras e a exclusão de obra. */
export interface DocumentosFixture extends DocumentosRepositorio {
  /** Séries com revisão vigente (não retirada) da obra. */
  quantidade(obraId: string): number
  removerObra(obraId: string): void
}

interface Linha extends RevisaoDocumento {
  obraId: string
  vinculos: VinculoDocumento[]
}

/** Adaptador de fixture dos documentos: o estado é próprio de cada instância. */
export function criarDocumentosFixture(deps: DepsDocumentosFixture = {}): DocumentosFixture {
  let contador = 0
  const {
    exigirAdmin = () => {},
    obraPorSlug = (slug) => ({ id: `obra-${slug}` }),
    tamanhoArquivo = () => undefined,
    conteudoArquivo = () => undefined,
    proximoId = () => ++contador,
    nomeUsuario = 'Você',
    semente = [],
  } = deps
  // Em ordem de registro: a última não retirada de cada série é a vigente.
  const linhas: Linha[] = []
  const sementes = new Map<string, Uint8Array>()

  for (const s of semente) {
    const obra = obraPorSlug(s.slug)
    const caminho = caminhoDocumento(obra.id, s.serie, s.sha256, extensaoArquivo(s.arquivoNome))
    sementes.set(caminho, s.conteudo)
    linhas.push({
      id: `doc-${proximoId()}`,
      obraId: obra.id,
      serie: s.serie,
      codigo: s.codigo,
      titulo: s.titulo,
      tipo: s.tipo,
      disciplina: s.disciplina,
      revisao: s.revisao,
      caminho,
      arquivoNome: s.arquivoNome,
      mime: s.mime,
      bytes: s.conteudo.byteLength,
      sha256: s.sha256,
      enviadoEm: s.enviadoEm,
      enviadoPorNome: nomeUsuario,
      retiradoEm: null,
      retiradoPorNome: null,
      vinculos: [],
    })
  }

  const vigentes = (obraId: string) => {
    const porSerie = new Map<string, Linha>()
    for (const l of linhas) if (l.obraId === obraId && !l.retiradoEm) porSerie.set(l.serie, l)
    return [...porSerie.values()]
  }

  function paraDocumento(l: Linha): Documento {
    return {
      id: l.id,
      serie: l.serie,
      codigo: l.codigo,
      titulo: l.titulo,
      tipo: l.tipo,
      disciplina: l.disciplina,
      revisao: l.revisao,
      caminho: l.caminho,
      arquivoNome: l.arquivoNome,
      mime: l.mime,
      bytes: l.bytes,
      sha256: l.sha256,
      enviadoEm: l.enviadoEm,
      enviadoPorNome: l.enviadoPorNome,
      revisoes: linhas.filter((x) => x.serie === l.serie).length,
      vinculos: [...l.vinculos].sort((a, b) => a.sigla.localeCompare(b.sigla) || a.globalId.localeCompare(b.globalId)),
    }
  }

  const nulosPorUltimo = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)

  return {
    async listarDocumentos(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia(
        vigentes(o.id)
          .sort(
            (a, b) =>
              nulosPorUltimo(a.disciplina, b.disciplina) ||
              a.tipo.localeCompare(b.tipo) ||
              nulosPorUltimo(a.codigo, b.codigo) ||
              a.titulo.localeCompare(b.titulo),
          )
          .map(paraDocumento),
      )
    },

    async historicoDocumento(serie) {
      exigirAdmin()
      const da = linhas.filter((l) => l.serie === serie)
      if (!da.length) throw new ErroAdmin('Documento não encontrado')
      return copia(
        da
          .map(
            (l): RevisaoDocumento => ({
              id: l.id,
              serie: l.serie,
              codigo: l.codigo,
              titulo: l.titulo,
              tipo: l.tipo,
              disciplina: l.disciplina,
              revisao: l.revisao,
              caminho: l.caminho,
              arquivoNome: l.arquivoNome,
              mime: l.mime,
              bytes: l.bytes,
              sha256: l.sha256,
              enviadoEm: l.enviadoEm,
              enviadoPorNome: l.enviadoPorNome,
              retiradoEm: l.retiradoEm,
              retiradoPorNome: l.retiradoPorNome,
            }),
          )
          .reverse(),
      )
    },

    async registrarDocumento(slug, r) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.serie)) {
        throw new ErroAdmin('Série do documento inválida: esperado um UUID')
      }
      if (!/^[0-9a-f]{64}$/.test(r.sha256)) {
        throw new ErroAdmin('SHA-256 do arquivo inválido: são 64 caracteres hexadecimais minúsculos')
      }
      const problema = problemaDocumento(r)
      if (problema) throw new ErroAdmin(problema)
      const esperado = caminhoDocumento(o.id, r.serie, r.sha256, extensaoArquivo(r.arquivoNome))
      if (r.caminho !== esperado) throw new ErroAdmin(`Caminho do documento inválido (esperado ${esperado})`)
      if (linhas.some((l) => l.serie === r.serie && l.obraId !== o.id)) {
        throw new ErroAdmin('Esta série de documento pertence a outra obra')
      }
      if (linhas.some((l) => l.serie === r.serie && l.revisao === r.revisao)) {
        throw new ErroAdmin(`A revisão ${r.revisao} já existe neste documento`)
      }
      const tamanho = tamanhoArquivo(r.caminho)
      if (tamanho === undefined) {
        throw new ErroAdmin(`Documento não encontrado no Storage (documentos/${r.caminho}): envie o arquivo antes de registrar`)
      }
      if (tamanho !== r.bytes) throw new ErroAdmin(`O arquivo no Storage tem ${tamanho} bytes, e não ${r.bytes}: envie o arquivo de novo`)
      const linha: Linha = {
        id: `doc-${proximoId()}`,
        obraId: o.id,
        serie: r.serie,
        codigo: r.codigo?.trim() || null,
        titulo: r.titulo.trim(),
        tipo: r.tipo,
        disciplina: r.disciplina || null,
        revisao: r.revisao,
        caminho: r.caminho,
        arquivoNome: r.arquivoNome.trim(),
        mime: r.mime,
        bytes: r.bytes,
        sha256: r.sha256,
        enviadoEm: new Date().toISOString(),
        enviadoPorNome: nomeUsuario,
        retiradoEm: null,
        retiradoPorNome: null,
        vinculos: [],
      }
      linhas.push(linha)
      return copia(paraDocumento(linha))
    },

    async retirarDocumento(id) {
      exigirAdmin()
      const l = linhas.find((x) => x.id === id)
      if (!l) throw new ErroAdmin('Documento não encontrado')
      if (l.retiradoEm) throw new ErroAdmin('Este documento já foi retirado')
      l.retiradoEm = new Date().toISOString()
      l.retiradoPorNome = nomeUsuario
    },

    async vincularDocumento(id, vinculos) {
      exigirAdmin()
      const l = linhas.find((x) => x.id === id)
      if (!l) throw new ErroAdmin('Documento não encontrado')
      if (l.retiradoEm) throw new ErroAdmin('Este documento foi retirado: não é possível alterar os vínculos')
      if (vinculos.length > 2000) throw new ErroAdmin('Vínculos demais: no máximo 2000 por documento')
      const novos = new Map<string, VinculoDocumento>()
      for (const v of vinculos) {
        if (v.tipo !== 'pavimento' && v.tipo !== 'elemento') {
          throw new ErroAdmin('Tipo de vínculo inválido: use pavimento ou elemento')
        }
        if (!/^[A-Z]{2,4}$/.test(v.sigla)) throw new ErroAdmin('Sigla do vínculo inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ)')
        if (typeof v.globalId !== 'string' || v.globalId.length < 1 || v.globalId.length > 64) {
          throw new ErroAdmin('GlobalId do vínculo inválido: use texto de 1 a 64 caracteres')
        }
        const chave = `${v.sigla}|${v.globalId}`
        if (!novos.has(chave)) novos.set(chave, { tipo: v.tipo, sigla: v.sigla, globalId: v.globalId, classe: v.classe ?? null, nome: v.nome ?? null })
      }
      l.vinculos = [...novos.values()]
      return copia(paraDocumento(l).vinculos)
    },

    async baixarDocumento(caminho) {
      exigirAdmin()
      const s = sementes.get(caminho)
      if (s) return new Blob([s as BlobPart])
      const c = conteudoArquivo(caminho)
      if (!c) throw new ErroAdmin('Não foi possível baixar o documento guardado.')
      return c instanceof Blob ? c : new Blob([c as BlobPart])
    },

    quantidade: (obraId) => vigentes(obraId).length,

    removerObra(obraId) {
      for (let i = linhas.length - 1; i >= 0; i--) {
        if (linhas[i].obraId !== obraId) continue
        sementes.delete(linhas[i].caminho)
        linhas.splice(i, 1)
      }
    },
  }
}
