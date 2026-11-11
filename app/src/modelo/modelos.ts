/**
 * Um `.frag` de uma disciplina. `arquivo` é onde o repositório o encontra: nome do arquivo em
 * `/modelos/<obra>/` na fixture, caminho no bucket `modelos` no Supabase. `hash` identifica o
 * conteúdo (chave do cache no aparelho).
 */
export interface ModeloFrag {
  sigla: string
  revisao: string | null
  arquivo: string
  bytes: number
  hash: string
}

/** Fixture: lê `app/public/modelos/<obra>/manifesto.json` (gerado por `npm run modelos`). */
export async function listarModelosLocais(slug: string): Promise<ModeloFrag[]> {
  const r = await fetch(`/modelos/${encodeURIComponent(slug)}/manifesto.json`)
  // O Vite devolve o index.html (200) para caminho inexistente: só JSON conta.
  if (r.status === 404 || !r.headers.get('content-type')?.includes('json')) return []
  if (!r.ok) throw new Error('Não foi possível carregar a lista de modelos.')
  const dados = (await r.json()) as { modelos?: ModeloFrag[] }
  return dados.modelos ?? []
}

export async function baixarModeloLocal(slug: string, modelo: ModeloFrag): Promise<ArrayBuffer> {
  const r = await fetch(urlModelo(slug, modelo))
  if (!r.ok) throw new Error(`Falha ao baixar ${modelo.sigla}.`)
  return r.arrayBuffer()
}

export function urlModelo(slug: string, modelo: ModeloFrag): string {
  return `/modelos/${encodeURIComponent(slug)}/${encodeURIComponent(modelo.arquivo)}?v=${modelo.hash}`
}
