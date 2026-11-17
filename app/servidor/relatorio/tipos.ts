/** Retorno da RPC `relatorio_pendencias` (ver docs/contrato-relatorios-painel.md, Parte 1). */

export interface FotoRelatorio {
  path: string
  largura: number
  altura: number
}

export interface EncerramentoRelatorio {
  em: string
  autor: string
  observacao: string | null
  fotos: FotoRelatorio[]
}

export interface PendenciaRelatorio {
  id: string
  obra: string
  pavimento: string
  ambiente: string
  situacao: 'aberta' | 'resolvida'
  aberta_em: string
  autor: string
  legenda: string | null
  dias: number
  fotos: FotoRelatorio[]
  encerramento: EncerramentoRelatorio | null
}

export interface RelatorioPendencias {
  gerado_em: string
  fuso: string
  /** `cabecalho`, `objeto`, `local`, `endereco` e `responsaveis`: cabeçalho do boletim (20261120090000). */
  organizacao: { nome: string; logo_path: string | null; cabecalho?: string[] }
  etapa: {
    id: string
    slug: string
    nome: string
    sigla: string
    objeto?: string | null
    local?: string | null
    endereco?: string | null
  }
  responsaveis?: { nome: string }[]
  obra: { id: string; slug: string; nome: string } | null
  pendencias: PendenciaRelatorio[]
}
