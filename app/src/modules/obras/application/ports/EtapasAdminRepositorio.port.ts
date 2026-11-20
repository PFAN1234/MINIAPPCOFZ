import type {
  Aditivo,
  DadosAditivo,
  DadosEtapa,
  EtapaDetalhe,
  EtapaLista,
  EtapaSalva,
  Responsavel,
  ResultadoExclusaoEtapa,
  ResumoEtapa,
} from '../../domain/tiposAdmin.ts'

/** Etapas do site de administração: cadastro, aditivos, responsáveis, arquivamento e exclusão. */
export interface EtapasAdminRepositorio {
  /** Etapas (ativas e arquivadas) por `ordem, nome`, com as contagens de obras. */
  listarEtapas(): Promise<EtapaLista[]>
  /** Cria (sem `id`; slug ou sigla repetidos são recusados) ou edita (com `id`; chave ausente mantém, `null` apaga). */
  salvarEtapa(dados: DadosEtapa): Promise<EtapaSalva>
  /** `admin_obter_etapa`: cadastro completo, aditivos, responsáveis, prazo e o que falta para o boletim. */
  obterEtapa(slug: string): Promise<EtapaDetalhe>
  /** Cria ou edita (com `id`) um aditivo; número repetido na etapa é recusado. */
  salvarAditivo(dados: DadosAditivo): Promise<Aditivo>
  removerAditivo(id: string): Promise<void>
  /** Substitui os responsáveis da etapa, na ordem da lista (vazia = nenhum). */
  definirResponsaveis(etapaId: string, lista: { usuario_id: string; funcao: string }[]): Promise<Responsavel[]>
  /** Arquiva (true) ou desarquiva (false) a etapa; devolve `arquivada_em`. Não mexe no arquivamento das obras. */
  arquivarEtapa(slug: string, arquivada: boolean): Promise<string | null>
  /** Desliga o grupo do Telegram da etapa e os tópicos das obras dela. */
  desvincularEtapa(slug: string): Promise<void>
  /** Obras e contagens do que a exclusão da etapa apaga. */
  resumoEtapa(slug: string): Promise<ResumoEtapa>
  /** Edge Function `admin-excluir-obra` (ação `excluir_etapa`): apaga a etapa e todas as obras dela. Irreversível. */
  excluirEtapa(slug: string, confirmacao: string): Promise<ResultadoExclusaoEtapa>
}
