import type { AmbienteDetalhe, CaminhoFoto, EtapaInicio, NovaObservacao, NovoEncerramento, Observacao, ObservacoesDoDia, PendenciaDetalhe, PublicacaoProblema, NovoRegistro, FiltroRegistros, ObraDetalhe, ObraDaLista, Organizacao, RegistroLocalizado, PainelRelatorios, Relatorios, ResultadoExclusaoBoletim, RegistroResumo, ResumoObra } from './tipos.ts'
import type { AcessosRepositorio } from '@modules/acessos/application/ports/AcessosRepositorio.port.ts'
import type { EquipeServicoRepositorio } from '@modules/acessos/application/ports/EquipeServicoRepositorio.port.ts'
import type { SessaoRepositorio } from '@modules/acessos/application/ports/SessaoRepositorio.port.ts'
import type { ModelosRepositorio } from '@modules/modelos/application/ports/ModelosRepositorio.port.ts'
import type { RaRepositorio } from '@modules/ra/application/ports/RaRepositorio.port.ts'

export interface Repositorio
  extends Pick<RaRepositorio, 'obterGeometria'>,
    SessaoRepositorio,
    EquipeServicoRepositorio,
    AcessosRepositorio,
    Pick<ModelosRepositorio, 'listarModelos' | 'baixarModelo'> {
  /** Obras em que o usuário participa, cada uma com a sua etapa. */
  listarObras(): Promise<ObraDaLista[]>
  /** Totais por obra visível (serviços, pendências abertas e resolvidas) e o papel do usuário. */
  resumoObras(): Promise<ResumoObra[]>
  /** Pavimentos (com planta ativa), ambientes e pendências abertas por ambiente. */
  obterObra(slug: string): Promise<ObraDetalhe>
  obterAmbiente(slug: string, codigo: string): Promise<AmbienteDetalhe>
  listarRegistros(filtro: FiltroRegistros): Promise<RegistroResumo[]>
  /** Pessoas que têm registros nas obras visíveis (`autores_registros`), pelo nome mostrado. */
  autoresRegistros(): Promise<{ id: string; nome: string }[]>
  /** URL assinada (1 h) ou local na fixture, indexada pelo caminho recebido. */
  urlsImagens(
    paths: string[],
    bucket?: 'plantas' | 'fotos',
  ): Promise<Record<string, string>>
  /** Envia o JPEG para `<obraId>/<registroId>/<fotoId>.jpg` (reenvio permitido até vincular). */
  enviarFoto(caminho: CaminhoFoto, blob: Blob): Promise<void>
  /** Idempotente pelo `id`. Falhas sobem como `ErroEnvio`. */
  concluirRegistro(dados: NovoRegistro): Promise<{ id: string }>
  /**
   * Só na implementação Supabase: há sessão ativa? Ausente na fixture, que
   * dispensa login. Sem sessão o app pede para abrir pelo Telegram.
   */
  /** Obras do grupo do Telegram do usuário em que ele ainda não tem acesso. */
  /** Pede acesso à obra (idempotente se já há pedido pendente). Falhas sobem como `ErroEnvio`. */
  /** Pedidos pendentes da obra, do mais antigo ao mais novo; só o gestor pode ver. */
  /** Gestor aprova ou recusa um pedido. Falhas sobem como `ErroEnvio`. */
  /** Lista de pessoas x obras (só gestor de alguma obra). Falhas sobem como `ErroEnvio`. */
  /** Define o acesso de uma pessoa a uma obra (qualquer gestor, qualquer obra). Falhas sobem como `ErroEnvio`. */
  /** Pendência com fotos, ambiente, pavimento, papel do usuário e encerramento; null se não houver acesso. */
  obterPendencia(id: string): Promise<PendenciaDetalhe | null>
  /** Idempotente pelo `id`. Falhas sobem como `ErroEnvio` (`conflito` se já encerrada). */
  encerrarPendencia(dados: NovoEncerramento): Promise<{ id: string }>
  /** Participantes da obra (só gestor), gestores primeiro. */
  /** Publicações `incerto`/`falhou` (e pendentes com muitas tentativas), mais recentes primeiro. */
  listarPublicacoesProblema(obraId: string): Promise<PublicacaoProblema[]>
  /** Volta a publicação para a fila de envio. */
  republicar(id: number): Promise<void>
  /** Gestor confirma que a mensagem já está no tópico. */
  marcarPublicada(id: number): Promise<void>
  /** Localiza um registro visível ao usuário (para o link `startapp`); null se não houver. */
  localizarRegistro(id: string): Promise<RegistroLocalizado | null>
  /** Id do usuário da sessão (fica no aparelho, funciona sem sinal) ou null sem sessão. */
  /** O usuário é admin do Mini App (site de administração)? */
  /** Link de uso único (2 min) para abrir o site de administração já com a sessão. */
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
  /** Nome e logo da organização militar (faixa de identidade do topo). */
  organizacao(): Promise<Organizacao>
  /** Observações de hoje na obra (dia no fuso da etapa), com o estado de travada do dia. */
  observacoesDoDia(obraId: string): Promise<ObservacoesDoDia>
  /** Cria (id novo) ou edita o texto (id existente). Idempotente. Falhas sobem como `ErroEnvio`. */
  salvarObservacao(dados: NovaObservacao): Promise<Observacao>
  /** Só o autor e antes da emissão do boletim; id inexistente não é erro. Falhas sobem como `ErroEnvio`. */
  excluirObservacao(id: string): Promise<void>
  /** Etapas ativas, com a participação do usuário. */
  etapasInicio(): Promise<EtapaInicio[]>
  /** Equipe de serviço da etapa (abertos e encerrados nas últimas 24 h). */
  /** Check-in (exige estar a até 1 km da etapa). Falhas sobem como `ErroEnvio`. */
  /** Fecha o serviço aberto do usuário. Devolve a equipe da etapa dele. */
}

/**
 * Ponto único de criação. A fixture entra por `import()` dinâmico atrás de uma
 * condição constante em tempo de build: sem `VITE_DADOS=fixture` o bundler
 * descarta o ramo e os dados de teste não vão para o `dist/`.
 */
export async function criarRepositorio(): Promise<Repositorio> {
  if (import.meta.env.VITE_DADOS === 'fixture') {
    const { criarRepositorioFixture } = await import('./fixture.ts')
    // `localStorage['fixture-admin'] = 'nao'` esconde o botão Administração;
    // `localStorage['fixture-logo'] = <url>` dá um logo à organização (capturas de tela);
    // `localStorage['fixture-boletim'] = 'emitido'` simula o boletim de hoje já emitido.
    return criarRepositorioFixture({
      persistencia: localStorage,
      admin: localStorage.getItem('fixture-admin') !== 'nao',
      logo: localStorage.getItem('fixture-logo'),
      boletimEmitido: localStorage.getItem('fixture-boletim') === 'emitido',
    })
  }
  const { criarRepositorioSupabase } = await import('./supabase.ts')
  return criarRepositorioSupabase()
}
