import type { PainelRelatorios, Relatorios, ResultadoExclusaoBoletim } from '@modules/relatorios/domain/tipos.ts'

export interface RelatoriosRepositorio {
  /** Aba Relatórios: situação de hoje por etapa e boletins emitidos. */
  relatorios(): Promise<Relatorios>
  /** Painel da aba Relatórios: movimento por obra e dia da etapa, até hoje. */
  painelRelatorios(etapaId: string): Promise<PainelRelatorios>
  /** Gera o PDF de pendências (etapa inteira ou uma obra) e devolve a URL assinada. */
  exportarPendencias(etapaId: string, obraId: string | null): Promise<string>
  /** URL assinada (5 min) do PDF de um boletim. */
  urlPdfBoletim(caminho: string): Promise<string>
  /** Admin: pede a emissão agora (nova revisão se já houver boletim no dia). Falhas sobem como `ErroEnvio`. */
  emitirBoletim(slug: string, data: string): Promise<void>
  /** Admin: exclui o dia inteiro do boletim (revisões, PDFs e mensagem no grupo). */
  excluirBoletim(id: string): Promise<ResultadoExclusaoBoletim>
}
