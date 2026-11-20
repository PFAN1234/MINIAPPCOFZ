import type { ConfigObra } from '@modules/plantas/domain/tipos.ts'
import type { DadosObra, Exclusao, ObraAdmin, ObraLista, ObraSalva, PavimentoResumo, ResultadoExclusao, ResumoObra } from '../../domain/tiposAdmin.ts'

/** Obras do site de administração: cadastro, pavimentos, configuração, arquivamento e exclusão. */
export interface ObrasAdminRepositorio {
  listarObras(): Promise<ObraLista[]>
  obterObra(slug: string): Promise<ObraAdmin>
  salvarObra(dados: DadosObra): Promise<ObraSalva>
  /** Lista completa: inclui, edita e apaga (só pavimento sem ambientes nem plantas). */
  salvarPavimentos(slug: string, lista: PavimentoResumo[]): Promise<PavimentoResumo[]>
  salvarConfig(slug: string, config: ConfigObra): Promise<void>
  exportarObra(slug: string): Promise<unknown>
  /** Arquiva (true) ou desarquiva (false); devolve `arquivada_em`. */
  arquivarObra(slug: string, arquivada: boolean): Promise<string | null>
  /** Contagens do que a exclusão apaga. */
  resumoObra(slug: string): Promise<ResumoObra>
  /** Edge Function `admin-excluir-obra`: apaga a obra, tudo dela e os arquivos. Irreversível. */
  excluirObra(slug: string, confirmacao: string): Promise<ResultadoExclusao>
  listarExclusoes(): Promise<Exclusao[]>
  /** Tenta de novo remover os arquivos de uma exclusão que ficou pendente. */
  limparExclusao(id: string): Promise<ResultadoExclusao>
}
