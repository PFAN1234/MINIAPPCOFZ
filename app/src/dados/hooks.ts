import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorio } from './contexto.tsx'
import type { FiltroRegistros } from './tipos.ts'

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
