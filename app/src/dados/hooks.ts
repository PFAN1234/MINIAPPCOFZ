import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { enviarRegistro, type Progresso, type Rascunho } from './envio.ts'
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

export function useSessao() {
  const repo = useRepositorio()
  return useQuery({
    queryKey: ['sessao'],
    queryFn: async () => (repo.temSessao ? await repo.temSessao() : true),
  })
}

export interface EntradaNovoRegistro {
  rascunho: Rascunho
  /** Slug da obra e código do ambiente, para invalidar as consultas certas. */
  slug: string
  codigo: string
  aoProgredir?: (p: Progresso) => void
}

/**
 * Envia o rascunho (fotos e depois a RPC). Reutilize o mesmo `rascunho` ao
 * tentar de novo. No sucesso invalida `['registros']`, `['obra', slug]` e
 * `['ambiente', slug, codigo]`. Erros chegam como `ErroEnvio`.
 */
export function useNovoRegistro() {
  const repo = useRepositorio()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rascunho, aoProgredir }: EntradaNovoRegistro) =>
      enviarRegistro(repo, rascunho, aoProgredir),
    onSuccess: async (_dados, { slug, codigo }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['registros'] }),
        qc.invalidateQueries({ queryKey: ['obra', slug] }),
        qc.invalidateQueries({ queryKey: ['ambiente', slug, codigo] }),
      ])
    },
  })
}
