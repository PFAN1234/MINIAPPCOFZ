import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EdicaoBoletim, FiltroBoletins } from '@modules/relatorios/domain/tiposAdmin.ts'
import { useRepositorioAdmin } from '../../../../admin/dados/contexto.tsx'

/** Boletins e pedidos da etapa; enquanto houver pedido na fila ou gerando, relê a cada 10 s. */
export function useBoletins(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'boletins', slug],
    queryFn: () => repo.listarBoletins(slug),
    refetchInterval: (q) =>
      q.state.data?.pedidos.some((p) => p.estado === 'pendente' || p.estado === 'gerando') ? 10_000 : false,
  })
}

export function usePedirEmissao(slug: string) {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: string) => repo.pedirEmissao(slug, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'boletins'] }),
  })
}

export function useReenviarBoletim(slug: string) {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (boletimId: string) => repo.reenviarBoletim(slug, boletimId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'boletins'] }),
  })
}

export function useExcluirBoletim(slug: string) {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (boletimId: string) => repo.excluirBoletim(slug, boletimId),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'boletins'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'boletim'] }),
      ]),
  })
}

/** Boletins e pedidos de todas as etapas (ou de uma), por período; relê a cada 10 s com pedido em andamento. */
export function useTodosBoletins(filtro: FiltroBoletins) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'boletins', 'todos', filtro.etapa ?? null, filtro.de ?? null, filtro.ate ?? null],
    queryFn: () => repo.listarTodosBoletins(filtro),
    refetchInterval: (q) =>
      q.state.data?.pedidos.some((p) => p.estado === 'pendente' || p.estado === 'gerando') ? 10_000 : false,
  })
}

/** Um boletim com snapshot, edição e rascunho (`admin_boletim`), para o editor. */
export function useBoletim(id: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'boletim', id], queryFn: () => repo.boletim(id) })
}

function useInvalidarBoletim(id: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'boletim', id] }),
      qc.invalidateQueries({ queryKey: ['admin', 'boletins'] }),
    ])
}

export function useSalvarRascunhoBoletim(id: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarBoletim(id)
  return useMutation({
    mutationFn: (edicao: EdicaoBoletim) => repo.salvarRascunhoBoletim(id, edicao),
    onSuccess: invalidar,
  })
}

export function useRetificarBoletim(id: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarBoletim(id)
  return useMutation({ mutationFn: (edicao: EdicaoBoletim) => repo.retificarBoletim(id, edicao), onSuccess: invalidar })
}

export function usePreviaBoletimEditado(id: string) {
  const repo = useRepositorioAdmin()
  return useMutation({ mutationFn: (edicao: EdicaoBoletim) => repo.previaBoletimEditado(id, edicao) })
}

/** URLs assinadas das fotos (em lote); ficam em cache por 30 min (a URL vale 1 h). */
export function useUrlsFotos(paths: string[]) {
  const repo = useRepositorioAdmin()
  const chave = [...new Set(paths)].sort()
  return useQuery({
    queryKey: ['admin', 'fotos-urls', chave],
    queryFn: () => repo.urlsFotos(chave),
    staleTime: 30 * 60_000,
    enabled: chave.length > 0,
  })
}

export function useUrlPdfBoletim() {
  const repo = useRepositorioAdmin()
  return useMutation({ mutationFn: (caminho: string) => repo.urlPdfBoletim(caminho) })
}

export function usePreviaBoletim(slug: string) {
  const repo = useRepositorioAdmin()
  return useMutation({ mutationFn: (data: string) => repo.previaBoletim(slug, data) })
}
