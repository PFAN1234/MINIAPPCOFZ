import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorio } from './contexto.tsx'
import type { EquipeServico, FiltroRegistros, NovaObservacao, PapelObra, Posicao } from './tipos.ts'

export function useObras() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['obras'], queryFn: () => repo.listarObras() })
}

/**
 * Nome e logo da organização militar, para a faixa de identidade do topo. Entra no cache
 * guardado no aparelho (vale sem sinal); em erro, a faixa mostra só "Fiscal Bot".
 */
export function useOrganizacao() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['organizacao'], queryFn: () => repo.organizacao(), staleTime: 5 * 60_000 })
}

/** Totais por obra para as barrinhas do Início e o botão Gestão. */
export function useResumoObras() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['resumo-obras'], queryFn: () => repo.resumoObras() })
}

export function useObra(slug: string) {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['obra', slug], queryFn: () => repo.obterObra(slug) })
}

export function useAmbiente(slug: string, codigo: string) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['ambiente', slug, codigo],
    queryFn: () => repo.obterAmbiente(slug, codigo),
  })
}

export function useRegistros(filtro: FiltroRegistros = {}) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['registros', filtro],
    queryFn: () => repo.listarRegistros(filtro),
  })
}

/** Pessoas com registros, para o filtro de pessoa de Registros. */
export function useAutoresRegistros() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['autores-registros'], queryFn: () => repo.autoresRegistros() })
}

/** URLs assinadas valem 1 h; renova um pouco antes. */
export function useUrlsImagens(paths: string[], bucket: 'plantas' | 'fotos' = 'plantas') {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['imagens', bucket, [...paths].sort()],
    queryFn: () => repo.urlsImagens(paths, bucket),
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
  })
}

/**
 * A sessão é resolvida uma vez por abertura do app. Ao entrar, as demais
 * consultas são invalidadas (podem ser de outro usuário ou de antes do login).
 */
export function useSessao() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['sessao'],
    networkMode: 'always',
    staleTime: Infinity,
    queryFn: async () => {
      if (!repo.temSessao) return true
      const entrou = await repo.temSessao()
      if (entrou) {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'sessao' })
      }
      return entrou
    },
  })
}

/** Admin do Mini App? Em caso de erro (ou sem sinal), o botão simplesmente não aparece. */
export function useSouAdmin() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['sou-admin'], queryFn: () => repo.souAdmin(), staleTime: 5 * 60_000 })
}

export function useCriarLinkAdmin() {
  const repo = useRepositorio()
  return useMutation({ mutationFn: () => repo.criarLinkAdmin() })
}

export function useObrasDisponiveis() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['obras-disponiveis'], queryFn: () => repo.obrasDisponiveis() })
}

export function useSolicitarAcesso() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (obraId: string) => repo.solicitarAcesso(obraId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['obras-disponiveis'] }),
  })
}

export function useSolicitacoes(obraId: string | undefined, habilitado = true) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['solicitacoes', obraId],
    queryFn: () => repo.listarSolicitacoes(obraId!),
    enabled: habilitado && !!obraId,
  })
}

export function useDecidirSolicitacao() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, aprovar }: { id: string; aprovar: boolean }) =>
      repo.decidirSolicitacao(id, aprovar),
    onSettled: () => qc.invalidateQueries({ queryKey: ['solicitacoes'] }),
  })
}

export function usePendencia(id: string) {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['pendencia', id], queryFn: () => repo.obterPendencia(id) })
}

export function useParticipantes(obraId: string | undefined, habilitado = true) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['participantes', obraId],
    queryFn: () => repo.listarParticipantes(obraId!),
    enabled: habilitado && !!obraId,
  })
}

export function useDefinirPapel(obraId: string) {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ usuarioId, papel }: { usuarioId: string; papel: PapelObra }) =>
      repo.definirPapel(obraId, usuarioId, papel),
    onSettled: () => qc.invalidateQueries({ queryKey: ['participantes', obraId] }),
  })
}

export function useRemoverParticipante(obraId: string) {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (usuarioId: string) => repo.removerParticipante(obraId, usuarioId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['participantes', obraId] }),
  })
}

export function usePublicacoesProblema(obraId: string | undefined, habilitado = true) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['publicacoes-problema', obraId],
    queryFn: () => repo.listarPublicacoesProblema(obraId!),
    enabled: habilitado && !!obraId,
  })
}

/** Reenviar ou marcar como publicada; ambas atualizam a lista e os registros. */
export function useResolverPublicacao() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, acao }: { id: number; acao: 'republicar' | 'marcar' }) =>
      acao === 'republicar' ? repo.republicar(id) : repo.marcarPublicada(id),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['publicacoes-problema'] }),
        qc.invalidateQueries({ queryKey: ['registros'] }),
        qc.invalidateQueries({ queryKey: ['resumo-obras'] }),
        qc.invalidateQueries({ queryKey: ['pendencia'] }),
      ]),
  })
}

/** Modelos 3D publicados da obra. */
export function useModelos(slug: string, habilitado = true) {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['modelos', slug], queryFn: () => repo.listarModelos(slug), enabled: habilitado })
}

/** Geometria do ambiente para a realidade aumentada; `null` quando o ambiente não tem. */
export function useGeometria(
  obra: { id: string; slug: string } | undefined,
  ambiente: { id: string; codigo: string } | undefined,
  habilitado = true,
) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['geometria', obra?.id, ambiente?.id],
    queryFn: () => repo.obterGeometria(obra!, ambiente!),
    enabled: habilitado && Boolean(obra && ambiente),
  })
}

/** Todas as etapas ativas (abas do Início), com a participação do usuário. */
export function useEtapasInicio() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['etapas-inicio'], queryFn: () => repo.etapasInicio() })
}

/** Equipe de serviço da etapa: refeita a cada 60 s e ao focar o app. */
export function useEquipeServico(etapaId: string | undefined) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['equipe-servico', etapaId],
    queryFn: () => repo.equipeServico(etapaId!),
    enabled: !!etapaId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Grava o retorno (equipe da etapa) no cache dela e invalida as das outras etapas. */
function useAtualizarEquipes() {
  const qc = useQueryClient()
  return (equipe: EquipeServico) => {
    qc.setQueryData(['equipe-servico', equipe.etapa_id], equipe)
    void qc.invalidateQueries({
      queryKey: ['equipe-servico'],
      predicate: (q) => q.queryKey[1] !== equipe.etapa_id,
    })
  }
}

/** Check-in na etapa, com a posição já obtida. Exige conexão. */
export function useCheckin(etapaId: string) {
  const repo = useRepositorio()
  const atualizar = useAtualizarEquipes()
  return useMutation({
    networkMode: 'always',
    mutationFn: (posicao: Posicao) => repo.fazerCheckin(etapaId, posicao),
    onSuccess: atualizar,
  })
}

/** Check-out do serviço aberto do usuário (em qualquer etapa). Exige conexão. */
export function useCheckout() {
  const repo = useRepositorio()
  const atualizar = useAtualizarEquipes()
  return useMutation({
    networkMode: 'always',
    mutationFn: () => repo.fazerCheckout(),
    onSuccess: atualizar,
  })
}

/** Observações de hoje na obra; entra no cache guardado no aparelho (aparece sem sinal). */
export function useObservacoesDoDia(obraId: string) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['observacoes', obraId],
    queryFn: () => repo.observacoesDoDia(obraId),
  })
}

/** Editar (texto novo, mesmo id) ou excluir uma observação; exigem conexão. */
export function useAlterarObservacao(obraId: string) {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    // Sem sinal a falha aparece na hora (os botões já ficam desabilitados), em vez de esperar a rede.
    networkMode: 'always',
    mutationFn: (
      acao: { tipo: 'editar'; dados: NovaObservacao } | { tipo: 'excluir'; id: string },
    ) =>
      acao.tipo === 'editar'
        ? repo.salvarObservacao(acao.dados).then(() => undefined)
        : repo.excluirObservacao(acao.id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['observacoes', obraId] }),
  })
}

/** Aba Relatórios. Reconsulta a cada 10 s enquanto alguma etapa tiver emissão pendente ou gerando. */
export function useRelatorios() {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['relatorios'],
    queryFn: () => repo.relatorios(),
    refetchInterval: (consulta) => {
      const etapas = consulta.state.data?.etapas ?? []
      const emAndamento = etapas.some((e) => e.pedido_hoje?.estado === 'pendente' || e.pedido_hoje?.estado === 'gerando')
      return emAndamento ? 10_000 : false
    },
  })
}

export function useEmitirBoletim() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, data }: { slug: string; data: string }) => repo.emitirBoletim(slug, data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['relatorios'] }),
  })
}

export function useExcluirBoletim() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repo.excluirBoletim(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['relatorios'] }),
  })
}

/** Painel da aba Relatórios (histórico inteiro da etapa). */
export function usePainelRelatorios(etapaId: string | null | undefined) {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['painel-relatorios', etapaId],
    queryFn: () => repo.painelRelatorios(etapaId as string),
    enabled: !!etapaId,
  })
}

export function useExportarPendencias() {
  const repo = useRepositorio()
  return useMutation({
    mutationFn: ({ etapaId, obraId }: { etapaId: string; obraId: string | null }) => repo.exportarPendencias(etapaId, obraId),
  })
}
