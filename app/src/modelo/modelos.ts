/** Um `.frag` de uma disciplina, como descrito em `manifesto.json` (gerado por `npm run modelos`). */
export interface ModeloFrag {
  sigla: string
  revisao: string | null
  arquivo: string
  bytes: number
  hash: string
}

/**
 * Modelos da obra. Por enquanto vêm de `/modelos/<obra>/` (arquivos do teste local);
 * na fase B passam a vir do Supabase Storage pelo `Repositorio`.
 */
export async function listarModelos(slug: string): Promise<ModeloFrag[]> {
  const r = await fetch(`/modelos/${encodeURIComponent(slug)}/manifesto.json`)
  // O Vite devolve o index.html (200) para caminho inexistente: só JSON conta.
  if (r.status === 404 || !r.headers.get('content-type')?.includes('json')) return []
  if (!r.ok) throw new Error('Não foi possível carregar a lista de modelos.')
  const dados = (await r.json()) as { modelos?: ModeloFrag[] }
  return dados.modelos ?? []
}

export function urlModelo(slug: string, modelo: ModeloFrag): string {
  return `/modelos/${encodeURIComponent(slug)}/${encodeURIComponent(modelo.arquivo)}?v=${modelo.hash}`
}
