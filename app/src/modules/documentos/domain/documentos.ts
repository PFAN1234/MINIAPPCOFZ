/**
 * Regras puras dos Documentos da obra (pranchas, memoriais, planilhas...): tipos, limites,
 * validação do envio e pequenas inferências a partir do nome do arquivo. As mesmas regras valem
 * na RPC `admin_registrar_documento`.
 */

export const LIMITE_BYTES = 104857600

export type TipoDocumento = 'prancha' | 'memorial' | 'planilha' | 'desenho' | 'imagem' | 'outro'

export const TIPOS_DOCUMENTO: readonly { valor: TipoDocumento; rotulo: string }[] = [
  { valor: 'prancha', rotulo: 'Prancha' },
  { valor: 'memorial', rotulo: 'Memorial' },
  { valor: 'planilha', rotulo: 'Planilha' },
  { valor: 'desenho', rotulo: 'Desenho (DWG/DXF)' },
  { valor: 'imagem', rotulo: 'Imagem' },
  { valor: 'outro', rotulo: 'Outro' },
]

export const EXTENSOES_DOCUMENTO = ['pdf', 'png', 'jpg', 'webp', 'dwg', 'dxf', 'xlsx', 'docx'] as const
export type ExtensaoDocumento = (typeof EXTENSOES_DOCUMENTO)[number]

/** Mesma lista do bucket `documentos`. */
export const MIMES_DOCUMENTO: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/acad',
  'image/vnd.dwg',
  'application/dxf',
  'image/vnd.dxf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
]

const MIME_POR_EXTENSAO: Record<ExtensaoDocumento, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  dwg: 'application/octet-stream',
  dxf: 'application/dxf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const SIGLA_DISCIPLINA = /^[A-Z]{2,4}$/
const REVISAO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/

export interface VinculoDocumento {
  tipo: 'pavimento' | 'elemento'
  /** Disciplina do modelo onde está o GlobalId. */
  sigla: string
  globalId: string
  /** Para revincular se o GlobalId sumir numa revisão do modelo. */
  classe?: string | null
  nome?: string | null
}

/** Revisão vigente de uma série, como a listagem mostra. */
export interface Documento {
  id: string
  /** Agrupa as revisões do mesmo documento. */
  serie: string
  codigo: string | null
  titulo: string
  tipo: TipoDocumento
  disciplina: string | null
  revisao: string
  caminho: string
  arquivoNome: string
  mime: string
  bytes: number
  sha256: string
  enviadoEm: string
  enviadoPorNome: string | null
  /** Quantas revisões a série tem (contando as retiradas). */
  revisoes: number
  vinculos: VinculoDocumento[]
}

/** Uma revisão no histórico da série. */
export interface RevisaoDocumento {
  id: string
  serie: string
  codigo: string | null
  titulo: string
  tipo: TipoDocumento
  disciplina: string | null
  revisao: string
  caminho: string
  arquivoNome: string
  mime: string
  bytes: number
  sha256: string
  enviadoEm: string
  enviadoPorNome: string | null
  retiradoEm: string | null
  retiradoPorNome: string | null
}

/** O que o usuário informa ao enviar (o arquivo vai em `bytes`). */
export interface NovoDocumento {
  titulo: string
  tipo: TipoDocumento
  codigo?: string | null
  disciplina?: string | null
  revisao: string
  arquivoNome: string
  mime: string
  bytes: Uint8Array
}

/** Campos da RPC `admin_registrar_documento`, em camelCase. */
export interface RegistroDocumento {
  serie: string
  codigo: string | null
  titulo: string
  tipo: TipoDocumento
  disciplina: string | null
  revisao: string
  caminho: string
  arquivoNome: string
  mime: string
  bytes: number
  sha256: string
}

/** Extensão em minúsculas, com `jpeg` normalizado para `jpg`; vazio se não houver. */
export function extensaoArquivo(nome: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(nome.trim())
  const ext = m ? m[1].toLowerCase() : ''
  return ext === 'jpeg' ? 'jpg' : ext
}

function extensaoPermitida(ext: string): ext is ExtensaoDocumento {
  return (EXTENSOES_DOCUMENTO as readonly string[]).includes(ext)
}

/**
 * Mime a enviar ao Storage: o do navegador, se for permitido (e mais específico que o genérico);
 * senão o inferido pela extensão. DWG sem mime vira `application/octet-stream`.
 */
export function mimeDoArquivo(nome: string, mimeDoNavegador: string): string {
  const ext = extensaoArquivo(nome)
  const inferido = extensaoPermitida(ext) ? MIME_POR_EXTENSAO[ext] : 'application/octet-stream'
  const mime = (mimeDoNavegador ?? '').trim().toLowerCase()
  if (!mime || !MIMES_DOCUMENTO.includes(mime)) return inferido
  if (mime === 'application/octet-stream') return inferido
  return mime
}

/** Mensagem pt-BR do primeiro problema do envio, ou `null` se estiver tudo certo. */
export function problemaDocumento(d: {
  titulo: string
  tipo: string
  revisao: string
  codigo?: string | null
  disciplina?: string | null
  arquivoNome: string
  bytes: number
  mime: string
}): string | null {
  const titulo = d.titulo.trim()
  if (titulo.length < 1 || titulo.length > 200) return 'Informe o título, com até 200 caracteres.'
  if (!TIPOS_DOCUMENTO.some((t) => t.valor === d.tipo)) return 'Escolha o tipo do documento.'
  if (d.codigo != null && d.codigo.trim().length > 60) return 'O código tem no máximo 60 caracteres.'
  if (d.disciplina != null && d.disciplina !== '' && !SIGLA_DISCIPLINA.test(d.disciplina)) {
    return 'Sigla da disciplina inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ).'
  }
  if (!REVISAO.test(d.revisao)) {
    return 'Revisão inválida: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R07).'
  }
  const nome = d.arquivoNome.trim()
  if (nome.length < 1 || nome.length > 200) return 'O nome do arquivo precisa ter de 1 a 200 caracteres.'
  if (!extensaoPermitida(extensaoArquivo(nome))) {
    return 'Arquivo não aceito: use PDF, PNG, JPG, WebP, DWG, DXF, XLSX ou DOCX.'
  }
  if (!Number.isInteger(d.bytes) || d.bytes <= 0) return 'O arquivo está vazio.'
  if (d.bytes > LIMITE_BYTES) return 'O arquivo passa do limite de 100 MB.'
  if (!MIMES_DOCUMENTO.includes(d.mime)) return 'Tipo de arquivo não permitido.'
  return null
}

/** Caminho no bucket `documentos`: `<obra_id>/<serie>/<sha256>.<ext>`. */
export function caminhoDocumento(obraId: string, serie: string, sha256: string, ext: string): string {
  return `${obraId}/${serie}/${sha256}.${ext === 'jpeg' ? 'jpg' : ext.toLowerCase()}`
}

/** Só PDF tem prévia no navegador. */
export function temPrevia(doc: Pick<Documento, 'mime' | 'arquivoNome'>): boolean {
  return doc.mime === 'application/pdf' || extensaoArquivo(doc.arquivoNome) === 'pdf'
}

/** R06 → R07, 2 → 3, A → B; sem padrão (ou Z), devolve ''. Mantém zeros à esquerda (R09 → R10, 007 → 008). */
export function sugerirProximaRevisao(rev: string): string {
  const r = rev.trim()
  const num = /^([A-Za-z]*?)(\d+)$/.exec(r)
  if (num) {
    const [, prefixo, digitos] = num
    const proximo = String(Number(digitos) + 1).padStart(digitos.length, '0')
    return prefixo + proximo
  }
  if (/^[A-Ya-y]$/.test(r)) return String.fromCharCode(r.charCodeAt(0) + 1)
  return ''
}

/** Tipo mais provável pela extensão (já normalizada ou não). */
export function tipoSugerido(ext: string): TipoDocumento {
  switch (ext.toLowerCase().replace(/^\./, '')) {
    case 'pdf':
      return 'prancha'
    case 'dwg':
    case 'dxf':
      return 'desenho'
    case 'xlsx':
      return 'planilha'
    case 'docx':
      return 'memorial'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return 'imagem'
    default:
      return 'outro'
  }
}
