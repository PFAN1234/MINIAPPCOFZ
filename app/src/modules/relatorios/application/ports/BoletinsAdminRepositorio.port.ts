import type {
  BoletimDetalhe,
  EdicaoBoletim,
  FiltroBoletins,
  ListaBoletins,
  ListaTodosBoletins,
  PedidoEmissao,
  ResultadoExclusaoBoletim,
} from '@modules/relatorios/domain/tiposAdmin.ts'

export interface BoletinsAdminRepositorio {
  /** `admin_listar_boletins`: emitidos e pedidos ainda não emitidos (pendentes, gerando, com falha). */
  listarBoletins(slug: string): Promise<ListaBoletins>
  /** `admin_pedir_emissao`: pede a emissão do boletim da data ("AAAA-MM-DD"). */
  pedirEmissao(slug: string, data: string): Promise<PedidoEmissao>
  /** `admin_reenviar_boletim`: recoloca na fila o envio ao Telegram de um boletim com falha/incerto. */
  reenviarBoletim(slug: string, boletimId: string): Promise<void>
  /** Exclui o dia inteiro do boletim (todas as revisões da etapa e data, PDFs e mensagens). */
  excluirBoletim(slug: string, boletimId: string): Promise<ResultadoExclusaoBoletim>
  /** URL (assinada, de curta duração) do PDF de um boletim no bucket `boletins`. */
  urlPdfBoletim(caminho: string): Promise<string>
  /** Gerador (`/api/previa-boletim`): PDF da prévia, sem número e sem gravar nada. */
  previaBoletim(slug: string, data: string): Promise<Blob>
  /** `admin_listar_todos_boletins`: boletins e pedidos de todas as etapas (ou de uma), por período. */
  listarTodosBoletins(filtro?: FiltroBoletins): Promise<ListaTodosBoletins>
  /** `admin_boletim`: um boletim com o snapshot, a edição e o rascunho. */
  boletim(id: string): Promise<BoletimDetalhe>
  /** `admin_salvar_rascunho_boletim`: salva o rascunho (edição vazia apaga; devolve `null`). */
  salvarRascunhoBoletim(id: string, edicao: EdicaoBoletim): Promise<{ atualizado_em: string } | null>
  /** `admin_retificar_boletim`: pede a retificação editada (próxima revisão do dia). */
  retificarBoletim(id: string, edicao: EdicaoBoletim): Promise<PedidoEmissao>
  /** Gerador (`POST /api/previa-boletim`): PDF do boletim com a edição aplicada, sem gravar nada. */
  previaBoletimEditado(id: string, edicao: EdicaoBoletim): Promise<Blob>
  /** URLs assinadas (bucket `fotos`) em lote: caminho → URL; caminho sem URL fica de fora. */
  urlsFotos(paths: string[]): Promise<Record<string, string>>
}
