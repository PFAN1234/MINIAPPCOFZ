import type { ErroCliente, ResumoOrfaos } from '@modules/operacao/domain/tipos.ts'

export interface TelemetriaRepositorio {
  /** RPC `admin_listar_erros_cliente`: erros do Mini App e do site, do mais recente ao mais antigo. */
  listarErrosCliente(limite?: number): Promise<ErroCliente[]>
  /** RPC `admin_resumo_orfaos`: arquivos órfãos por bucket e os 100 maiores (nada é apagado). */
  resumoOrfaos(): Promise<ResumoOrfaos>
}
