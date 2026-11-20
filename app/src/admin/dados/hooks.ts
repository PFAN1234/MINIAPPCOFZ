import type { QrAmbiente } from '@modules/ra/domain/tipos.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorioAdmin } from './contexto.tsx'
import type { PapelAcesso } from '@modules/acessos/domain/tipos.ts'

/** Depois de gravar algo ligado a obras/etapas, relê as consultas do admin (exceto sessão). */
function useInvalidarAdmin() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'sessao' })
}

// --- Pessoas -----------------------------------------------------------------------------------

export function usePessoas() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'pessoas'], queryFn: () => repo.listarPessoas() })
}

/** Os nomes aparecem também nos responsáveis das etapas: relê tudo do admin. */
export function useDefinirNomeExibicao() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmin()
  return useMutation({
    mutationFn: (p: { id: string; nome: string | null }) => repo.definirNomeExibicao(p.id, p.nome),
    onSuccess: invalidar,
  })
}

export function useMatrizAcessos() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'matriz-acessos'], queryFn: () => repo.matrizAcessos() })
}

export function useMeuId() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'meu-id'], queryFn: () => repo.meuId(), staleTime: Infinity })
}

export function useDefinirAcesso() {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: { obraId: string; usuarioId: string; papel: PapelAcesso }) =>
      repo.definirAcesso(p.obraId, p.usuarioId, p.papel),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'matriz-acessos'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'pessoas'] }),
      ])
    },
  })
}

export function useAdmins() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'admins'], queryFn: () => repo.listarAdmins() })
}

export function useResumoOrfaos() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'orfaos'], queryFn: () => repo.resumoOrfaos() })
}

export function useErrosCliente() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'erros-cliente'], queryFn: () => repo.listarErrosCliente() })
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

// --- Planta (fase 2) ---------------------------------------------------------------------------

export function useEditorPlanta(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'planta', slug],
    queryFn: () => repo.obterEditorPlanta(slug),
    // O editor guarda edições locais: não reler sozinho por trás delas.
    staleTime: Infinity,
  })
}

export function usePublicacoes(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'publicacoes', slug], queryFn: () => repo.listarPublicacoes(slug) })
}

/** Depois de publicar: relê obra, lista, planta e histórico. */
export function useInvalidarPlanta() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'sessao' })
}

export function useModelosAdmin(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'modelos', slug], queryFn: () => repo.listarModelosAdmin(slug) })
}

export function useRetirarModelo(slug: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmin()
  return useMutation({ mutationFn: (sigla: string) => repo.retirarModelo(slug, sigla), onSuccess: invalidar })
}

export function useAmbientesRA(obraId: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'ra', obraId], queryFn: () => repo.listarRA(obraId) })
}

export function useDefinirQr() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmin()
  return useMutation({
    mutationFn: (p: { ambienteId: string; qr: QrAmbiente }) => repo.definirQr(p.ambienteId, p.qr),
    onSuccess: invalidar,
  })
}

export function useRemoverQr() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmin()
  return useMutation({ mutationFn: (ambienteId: string) => repo.removerQr(ambienteId), onSuccess: invalidar })
}
