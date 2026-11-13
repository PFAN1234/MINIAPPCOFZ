import type {
  AmbienteDetalhe,
  CaminhoFoto,
  EquipeServico,
  EtapaInicio,
  Posicao,
  NovaObservacao,
  NovoEncerramento,
  Observacao,
  ObservacoesDoDia,
  Participante,
  PendenciaDetalhe,
  PublicacaoProblema,
  PapelObra,
  NovoRegistro,
  FiltroRegistros,
  LinkAdmin,
  ObraDetalhe,
  ObraDaLista,
  ObraDisponivel,
  Organizacao,
  RegistroLocalizado,
  RegistroResumo,
  ResumoObra,
  SolicitacaoAcesso,
} from './tipos.ts'
import type { ModeloFrag } from '../modelo/modelos.ts'
import type { GeometriaAmbiente } from '../ra/geometria.ts'

export interface Repositorio {
  /** Obras em que o usuário participa, cada uma com a sua etapa. */
  listarObras(): Promise<ObraDaLista[]>
  /** Totais por obra visível (serviços, pendências abertas e resolvidas) e o papel do usuário. */
  resumoObras(): Promise<ResumoObra[]>
  /** Pavimentos (com planta ativa), ambientes e pendências abertas por ambiente. */
  obterObra(slug: string): Promise<ObraDetalhe>
  obterAmbiente(slug: string, codigo: string): Promise<AmbienteDetalhe>
  listarRegistros(filtro: FiltroRegistros): Promise<RegistroResumo[]>
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
  temSessao?(): Promise<boolean>
  /** Obras do grupo do Telegram do usuário em que ele ainda não tem acesso. */
  obrasDisponiveis(): Promise<ObraDisponivel[]>
  /** Pede acesso à obra (idempotente se já há pedido pendente). Falhas sobem como `ErroEnvio`. */
  solicitarAcesso(obraId: string): Promise<void>
  /** Pedidos pendentes da obra, do mais antigo ao mais novo; só o gestor pode ver. */
  listarSolicitacoes(obraId: string): Promise<SolicitacaoAcesso[]>
  /** Gestor aprova ou recusa um pedido. Falhas sobem como `ErroEnvio`. */
  decidirSolicitacao(id: string, aprovar: boolean): Promise<void>
  /** Pendência com fotos, ambiente, pavimento, papel do usuário e encerramento; null se não houver acesso. */
  obterPendencia(id: string): Promise<PendenciaDetalhe | null>
  /** Idempotente pelo `id`. Falhas sobem como `ErroEnvio` (`conflito` se já encerrada). */
  encerrarPendencia(dados: NovoEncerramento): Promise<{ id: string }>
  /** Participantes da obra (só gestor), gestores primeiro. */
  listarParticipantes(obraId: string): Promise<Participante[]>
  definirPapel(obraId: string, usuarioId: string, papel: PapelObra): Promise<void>
  removerParticipante(obraId: string, usuarioId: string): Promise<void>
  /** Publicações `incerto`/`falhou` (e pendentes com muitas tentativas), mais recentes primeiro. */
  listarPublicacoesProblema(obraId: string): Promise<PublicacaoProblema[]>
  /** Volta a publicação para a fila de envio. */
  republicar(id: number): Promise<void>
  /** Gestor confirma que a mensagem já está no tópico. */
  marcarPublicada(id: number): Promise<void>
  /** Localiza um registro visível ao usuário (para o link `startapp`); null se não houver. */
  localizarRegistro(id: string): Promise<RegistroLocalizado | null>
  /** `.frag` publicados da obra (um por disciplina), por sigla. Lista vazia se não há nenhum. */
  listarModelos(slug: string): Promise<ModeloFrag[]>
  /** Baixa o `.frag`. O cache por hash fica a cargo de quem chama (`modeloComCache`). */
  baixarModelo(slug: string, modelo: ModeloFrag): Promise<ArrayBuffer>
  /**
   * Geometria do ambiente para a realidade aumentada (contorno, piso, forro, QR e
   * referencial dos modelos); null se o ambiente não tem geometria.
   */
  obterGeometria(obra: { id: string; slug: string }, ambiente: { id: string; codigo: string }): Promise<GeometriaAmbiente | null>
  /** Id do usuário da sessão (fica no aparelho, funciona sem sinal) ou null sem sessão. */
  idUsuario(): Promise<string | null>
  /** O usuário é admin do Mini App (site de administração)? */
  souAdmin(): Promise<boolean>
  /** Link de uso único (2 min) para abrir o site de administração já com a sessão. */
  criarLinkAdmin(): Promise<LinkAdmin>
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
  equipeServico(etapaId: string): Promise<EquipeServico>
  /** Check-in (exige estar a até 1 km da etapa). Falhas sobem como `ErroEnvio`. */
  fazerCheckin(etapaId: string, posicao: Posicao): Promise<EquipeServico>
  /** Fecha o serviço aberto do usuário. Devolve a equipe da etapa dele. */
  fazerCheckout(): Promise<EquipeServico>
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
