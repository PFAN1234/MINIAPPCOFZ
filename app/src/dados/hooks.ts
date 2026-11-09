import { useQuery } from '@tanstack/react-query'
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
    networkMode: 'always',
    queryFn: async () => (repo.temSessao ? await repo.temSessao() : true),
  })
}
