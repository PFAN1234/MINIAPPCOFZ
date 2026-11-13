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
  organizacao: { nome: string; logo_path: string | null }
  etapa: { id: string; slug: string; nome: string; sigla: string }
  obra: { id: string; slug: string; nome: string } | null
  pendencias: PendenciaRelatorio[]
}
