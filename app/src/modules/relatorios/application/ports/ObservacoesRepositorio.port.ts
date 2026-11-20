import type { NovaObservacao, Observacao, ObservacoesDoDia } from '@modules/relatorios/domain/tipos.ts'

export interface ObservacoesRepositorio {
  /** Observações de hoje na obra (dia no fuso da etapa), com o estado de travada do dia. */
  observacoesDoDia(obraId: string): Promise<ObservacoesDoDia>
  /** Cria (id novo) ou edita o texto (id existente). Idempotente. Falhas sobem como `ErroEnvio`. */
  salvarObservacao(dados: NovaObservacao): Promise<Observacao>
  /** Só o autor e antes da emissão do boletim; id inexistente não é erro. Falhas sobem como `ErroEnvio`. */
  excluirObservacao(id: string): Promise<void>
}
