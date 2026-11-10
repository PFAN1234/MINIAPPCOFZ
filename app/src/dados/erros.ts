/** Erros do envio de registros, já com mensagem em português para a tela. */

export type TipoErroEnvio =
  | 'sessao'
  | 'permissao'
  | 'nao_encontrado'
  | 'conflito'
  | 'validacao'
  | 'rede'
  | 'desconhecido'

export const MENSAGEM_REDE = 'Sem conexão com o servidor. Verifique o sinal e tente de novo.'

export class ErroEnvio extends Error {
  readonly tipo: TipoErroEnvio
  constructor(tipo: TipoErroEnvio, message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes)
    this.name = 'ErroEnvio'
    this.tipo = tipo
  }
}

const POR_CODIGO: Record<string, TipoErroEnvio> = {
  '28000': 'sessao',
  '42501': 'permissao',
  P0002: 'nao_encontrado',
  '23505': 'conflito',
  '22023': 'validacao',
}

const PADRAO_REDE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i
const PADRAO_RLS = /row-level security|row level security|unauthorized|forbidden/i
const PADRAO_JWT = /jwt|token.*(expired|invalid)|not authenticated/i

interface Bruto {
  code?: unknown
  message?: unknown
  status?: unknown
  statusCode?: unknown
  originalError?: unknown
  cause?: unknown
}

function ehRede(e: unknown, bruto: Bruto, mensagem: string): boolean {
  if (e instanceof TypeError) return true
  if (bruto.originalError instanceof TypeError || bruto.cause instanceof TypeError) return true
  return PADRAO_REDE.test(mensagem)
}

/**
 * Converte o erro de uma chamada do supabase-js (PostgREST com `code`, Storage
 * com `statusCode`, falha de `fetch`) em `ErroEnvio`.
 */
export function erroDoSupabase(e: unknown): ErroEnvio {
  if (e instanceof ErroEnvio) return e
  const bruto: Bruto = typeof e === 'object' && e !== null ? (e as Bruto) : {}
  const mensagem = typeof bruto.message === 'string' ? bruto.message : String(e ?? '')
  const codigo = typeof bruto.code === 'string' ? bruto.code : ''
  const status = Number(bruto.statusCode ?? bruto.status)

  if (ehRede(e, bruto, mensagem)) return new ErroEnvio('rede', MENSAGEM_REDE, { cause: e })

  const tipoCodigo = POR_CODIGO[codigo]
  if (tipoCodigo) return new ErroEnvio(tipoCodigo, mensagem, { cause: e })

  if (codigo === 'PGRST301' || codigo === 'PGRST303' || status === 401 || PADRAO_JWT.test(mensagem)) {
    return new ErroEnvio('sessao', 'Sua sessão expirou. Abra o app novamente pelo Telegram.', {
      cause: e,
    })
  }
  if (status === 403 || PADRAO_RLS.test(mensagem)) {
    return new ErroEnvio('permissao', 'Sem permissão para enviar esta foto.', { cause: e })
  }
  // O Storage responde 400 com a mensagem de RLS ao reenviar um objeto já vinculado.
  if (status === 404) return new ErroEnvio('nao_encontrado', mensagem || 'Não encontrado.', { cause: e })
  if (status === 413) {
    return new ErroEnvio('validacao', 'A foto é grande demais para ser enviada.', { cause: e })
  }
  return new ErroEnvio('desconhecido', mensagem || 'Não foi possível enviar o registro.', {
    cause: e,
  })
}
