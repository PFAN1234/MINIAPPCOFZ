import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorioAdmin } from './contexto.tsx'
import type { ConfigObra, DadosObra, PavimentoResumo } from './tipos.ts'

export function useObrasAdmin() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'obras'], queryFn: () => repo.listarObras() })
}

export function useObraAdmin(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'obra', slug], queryFn: () => repo.obterObra(slug) })
}

/** Depois de gravar qualquer coisa de uma obra, a lista e a obra são relidas. */
function useInvalidarObras() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'sessao' })
}

export function useSalvarObra() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (d: DadosObra) => repo.salvarObra(d), onSuccess: invalidar })
}

export function useSalvarPavimentos(slug: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({
    mutationFn: (lista: PavimentoResumo[]) => repo.salvarPavimentos(slug, lista),
    onSuccess: invalidar,
  })
}

export function useSalvarConfig(slug: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({
    mutationFn: (config: ConfigObra) => repo.salvarConfig(slug, config),
    onSuccess: invalidar,
  })
}

export function useExportarObra() {
  const repo = useRepositorioAdmin()
  return useMutation({ mutationFn: (slug: string) => repo.exportarObra(slug) })
}

export function useAdmins() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'admins'], queryFn: () => repo.listarAdmins() })
}

export function useUsuarios() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'usuarios'], queryFn: () => repo.listarUsuarios() })
}

function useInvalidarAdmins() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'admins'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'sessao'] }),
    ])
}

export function useIncluirAdmin() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmins()
  return useMutation({ mutationFn: (id: string) => repo.incluirAdmin(id), onSuccess: invalidar })
}

export function useRemoverAdmin() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmins()
  return useMutation({ mutationFn: (id: string) => repo.removerAdmin(id), onSuccess: invalidar })
}
