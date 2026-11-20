/** Linha crua devolvida pelas consultas e RPCs. */
export type Linha = Record<string, unknown>

export const MENSAGEM_REDE = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'

export const textoOuNulo = (v: unknown) => (v == null ? null : String(v))
export const numeroOuNulo = (v: unknown) => (v == null ? null : Number(v))

/** Mensagem crua do Postgres para violação de unicidade (as das RPCs já vêm em português). */
export const ehMensagemBruta = (msg: string) => /duplicate key|violates unique|unique constraint/i.test(msg)

/** Código (`23505` etc.) do erro original guardado em `cause` por `erroDaRpc`. */
export const codigoDe = (e: unknown) => {
  const causa = (e as Error).cause
  return causa && typeof causa === 'object' ? ((causa as { code?: unknown }).code as unknown) : undefined
}

export type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>
/** Chama a Edge Function `admin-excluir-obra` com a sessão do admin; devolve o JSON da resposta. */
export type FuncaoExcluir = (corpo: Record<string, unknown>, naoEncontrado: string) => Promise<Record<string, unknown>>
