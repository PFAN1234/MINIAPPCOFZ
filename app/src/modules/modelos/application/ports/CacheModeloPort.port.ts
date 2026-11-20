/** Cache do `.frag` no aparelho: devolve o guardado (`chave` inclui o hash) ou baixa e guarda. */
export type CacheModeloPort = (chave: string, baixar: () => Promise<ArrayBuffer>) => Promise<ArrayBuffer>
