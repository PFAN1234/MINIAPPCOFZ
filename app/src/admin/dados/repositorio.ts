import type { AcessosAdminRepositorio } from '@modules/acessos/application/ports/AcessosAdminRepositorio.port.ts'
import type { AcessosRepositorio } from '@modules/acessos/application/ports/AcessosRepositorio.port.ts'
import type { SessaoAdminRepositorio } from '@modules/acessos/application/ports/SessaoAdminRepositorio.port.ts'
import type { EtapasAdminRepositorio } from '@modules/obras/application/ports/EtapasAdminRepositorio.port.ts'
import type { ObrasAdminRepositorio } from '@modules/obras/application/ports/ObrasAdminRepositorio.port.ts'
import type { OrganizacaoAdminRepositorio } from '@modules/obras/application/ports/OrganizacaoAdminRepositorio.port.ts'
import type { ModelosRepositorio } from '@modules/modelos/application/ports/ModelosRepositorio.port.ts'
import type { PlantasRepositorio } from '@modules/plantas/application/ports/PlantasRepositorio.port.ts'
import type { RaRepositorio } from '@modules/ra/application/ports/RaRepositorio.port.ts'
import type { ErroCliente, ResumoOrfaos, BoletimDetalhe, EdicaoBoletim, FiltroBoletins, ListaBoletins, ListaTodosBoletins, PedidoEmissao, ResultadoExclusaoBoletim } from './tipos.ts'

export interface RepositorioAdmin
  extends SessaoAdminRepositorio,
    AcessosAdminRepositorio,
    Pick<AcessosRepositorio, 'definirAcesso'>,
    Pick<RaRepositorio, 'listarRA' | 'definirQr' | 'removerQr'>,
    EtapasAdminRepositorio,
    OrganizacaoAdminRepositorio,
    ObrasAdminRepositorio,
    Pick<ModelosRepositorio, 'listarModelosAdmin' | 'registrarModelo' | 'retirarModelo'>,
    Pick<PlantasRepositorio, 'obterEditorPlanta' | 'listarPublicacoes' | 'enviarArquivo' | 'baixarOriginal' | 'publicarRevisao'> {
  /** Há sessão? É de um admin? */
  /** Troca o token do link `#entrar=` (uso único) por sessão. */
  /** Troca os dados do Telegram Login Widget por sessão (só admins). */
  /** Só na fixture: entra sem Telegram (desenvolvimento e e2e). */

  /** `admin_listar_boletins`: emitidos e pedidos ainda não emitidos (pendentes, gerando, com falha). */
  listarBoletins(slug: string): Promise<ListaBoletins>
  /**
   * `admin_pedir_emissao`: pede a emissão do boletim da data ("AAAA-MM-DD"); se já houver boletim
   * na data, é uma retificação. Data futura ou pedido em andamento para a data são recusados.
   */
  pedirEmissao(slug: string, data: string): Promise<PedidoEmissao>
  /**
   * `admin_reenviar_boletim`: recoloca na fila o envio ao Telegram de um boletim cuja publicação
   * falhou ou ficou incerta. Já publicado ou envio em andamento são recusados.
   */
  reenviarBoletim(slug: string, boletimId: string): Promise<void>
  /**
   * Exclui o DIA INTEIRO do boletim (todas as revisões da etapa e data, os PDFs e as mensagens no
   * grupo do Telegram). Erro se o boletim não existir ou houver emissão/envio em andamento.
   */
  excluirBoletim(slug: string, boletimId: string): Promise<ResultadoExclusaoBoletim>
  /** URL (assinada, de curta duração) do PDF de um boletim no bucket `boletins`. */
  urlPdfBoletim(caminho: string): Promise<string>
  /** Gerador (`/api/previa-boletim`): PDF da prévia, sem número e sem gravar nada. */
  previaBoletim(slug: string, data: string): Promise<Blob>
  /** `admin_listar_todos_boletins`: boletins e pedidos de todas as etapas (ou de uma), por período. */
  listarTodosBoletins(filtro?: FiltroBoletins): Promise<ListaTodosBoletins>
  /** `admin_boletim`: um boletim com o snapshot, a edição e o rascunho (inexistente: erro). */
  boletim(id: string): Promise<BoletimDetalhe>
  /** `admin_salvar_rascunho_boletim`: salva o rascunho (edição vazia apaga; devolve `null`). Só a última revisão. */
  salvarRascunhoBoletim(id: string, edicao: EdicaoBoletim): Promise<{ atualizado_em: string } | null>
  /** `admin_retificar_boletim`: pede a retificação editada (próxima revisão do dia). */
  retificarBoletim(id: string, edicao: EdicaoBoletim): Promise<PedidoEmissao>
  /** Gerador (`POST /api/previa-boletim`): PDF do boletim com a edição aplicada, sem gravar nada. */
  previaBoletimEditado(id: string, edicao: EdicaoBoletim): Promise<Blob>
  /** URLs assinadas (bucket `fotos`) em lote: caminho → URL; caminho sem URL fica de fora. */
  urlsFotos(paths: string[]): Promise<Record<string, string>>

  /** Pessoas que já abriram o Mini App, com nome de exibição e participações nas obras. */
  /** Normaliza (maiúsculas, espaços); texto vazio ou null tira o nome de exibição. */
  /** RPC `matriz_acessos`: obras, pessoas, acessos por obra e pedidos pendentes. */
  /** RPC `definir_acesso`: `nenhum` tira o acesso (e recusa o pedido pendente); liberar aprova o pedido. */
  /** Id do usuário da sessão atual (para confirmar a alteração do próprio acesso). */
  /** RPC `admin_listar_erros_cliente`: erros do Mini App e do site, do mais recente ao mais antigo. */
  listarErrosCliente(limite?: number): Promise<ErroCliente[]>
  /** RPC `admin_resumo_orfaos`: arquivos órfãos por bucket e os 100 maiores (nada é apagado). */
  resumoOrfaos(): Promise<ResumoOrfaos>
}

/** Como no app: a fixture só entra no build com `VITE_DADOS=fixture`. */
export async function criarRepositorioAdmin(): Promise<RepositorioAdmin> {
  if (import.meta.env.VITE_DADOS === 'fixture') {
    const { criarRepositorioAdminFixture } = await import('./fixture.ts')
    // `localStorage['fixture-admin'] = 'nao'` simula um usuário que não é admin.
    let admin = true
    try {
      admin = localStorage.getItem('fixture-admin') !== 'nao'
    } catch {
      // sem localStorage: admin
    }
    return criarRepositorioAdminFixture({ admin })
  }
  const { criarRepositorioAdminSupabase } = await import('./supabase.ts')
  return criarRepositorioAdminSupabase()
}
