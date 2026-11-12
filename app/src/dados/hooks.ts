import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorio } from './contexto.tsx'
import type { FiltroRegistros, PapelObra } from './tipos.ts'

export function useObras() {
  const repo = useRepositorio()
  return useQuery({ queryKey: ['obras'], queryFn: () => repo.listarObras() })
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

/** Pendências abertas de todas as obras: a consulta do Início, também lida pela barra inferior. */
export const FILTRO_PENDENCIAS_ABERTAS: FiltroRegistros = { tipo: 'pendencia', situacao: 'aberta' }

/**
 * Total de pendências abertas para a barra inferior, tirado da mesma consulta do Início.
 * Não busca nada sozinho: enquanto não houver dados (os do Início ou os guardados no aparelho),
 * devolve `undefined`. Com dados, acompanha a consulta e é refeito só quando ela é invalidada
 * (depois de um envio), para o número não ficar velho fora do Início.
 */
export function useTotalPendenciasAbertas(): number | undefined {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['registros', FILTRO_PENDENCIAS_ABERTAS],
    queryFn: () => repo.listarRegistros(FILTRO_PENDENCIAS_ABERTAS),
    enabled: (consulta) => consulta.state.data !== undefined,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    select: (lista) => lista.length,
  }).data
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
