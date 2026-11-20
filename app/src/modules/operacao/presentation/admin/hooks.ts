import { useQuery } from '@tanstack/react-query'
import { useRepositorioAdmin } from '../../../../admin/dados/contexto.tsx'

export function useResumoOrfaos() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'orfaos'], queryFn: () => repo.resumoOrfaos() })
}

export function useErrosCliente() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'erros-cliente'], queryFn: () => repo.listarErrosCliente() })
}
