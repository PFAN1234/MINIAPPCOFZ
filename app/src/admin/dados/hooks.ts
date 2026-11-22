import type { QrAmbiente } from '@modules/ra/domain/tipos.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorioAdmin } from './contexto.tsx'
import { adicionarVista, criarIssueComVista } from '@modules/issues/application/use-cases/criarIssueComVista.ts'
import type { DadosIssue, TopicoBcf } from '@modules/issues/domain/issues.ts'
import type { Vista } from '@modules/modelos/domain/central.ts'
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

export function useDocumentos(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'documentos', slug], queryFn: () => repo.listarDocumentos(slug) })
}

/** Histórico da série; sem série, não busca. */
export function useHistoricoDocumento(serie: string | null) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'documentos', 'historico', serie],
    queryFn: () => repo.historicoDocumento(serie as string),
    enabled: serie !== null,
  })
}

export function useRetirarDocumento() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarAdmin()
  return useMutation({ mutationFn: (id: string) => repo.retirarDocumento(id), onSuccess: invalidar })
}

// --- Issues ------------------------------------------------------------------------------------

/** Depois de gravar uma issue: relê a lista da obra e a Central (issues abertas no card). */
function useInvalidarIssues(obraId: string | null) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'issues', obraId] }),
      qc.invalidateQueries({ queryKey: ['admin', 'central', 'obras'] }),
    ])
}

/** Issues da obra (por id, não slug: é o que as RPCs pedem); sem obra, não busca. Responsáveis: `useAdmins()`. */
export function useIssues(obraId: string | null) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'issues', obraId],
    queryFn: () => repo.listarIssues(obraId as string),
    enabled: obraId !== null,
  })
}

/** Cria (sem `id`) ou atualiza (com `id`, só as chaves de `dados`). */
export function useSalvarIssue(obraId: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarIssues(obraId)
  return useMutation({
    mutationFn: (p: { id?: string; dados: DadosIssue }) => repo.salvarIssue(obraId, p.dados, p.id),
    onSuccess: invalidar,
    // Também se a issue foi criada e a imagem falhou
    onError: invalidar,
  })
}

export function useComentarIssue(obraId: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarIssues(obraId)
  return useMutation({
    mutationFn: (p: { issueId: string; texto: string; vistaId?: string | null }) =>
      repo.comentarIssue(p.issueId, p.texto, p.vistaId),
    onSuccess: invalidar,
  })
}

/** Cria a issue e, se houver `vista`, envia o PNG e salva a vista (ver `criarIssueComVista`). */
export function useCriarIssueComVista(obraId: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarIssues(obraId)
  return useMutation({
    mutationFn: (p: { dados: DadosIssue & { titulo: string }; vista?: Vista | null; imagem?: Blob | null }) =>
      criarIssueComVista({ deps: repo, obraId, ...p }),
    onSuccess: invalidar,
    onError: invalidar,
  })
}

/** Acrescenta uma vista (com PNG opcional) a uma issue existente. */
export function useAdicionarVistaIssue(obraId: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarIssues(obraId)
  return useMutation({
    mutationFn: (p: { issue: { id: string; numero?: number }; vista: Vista; imagem?: Blob | null }) =>
      adicionarVista({ deps: repo, obraId, ...p }),
    onSuccess: invalidar,
  })
}

export function useImportarBcf(obraId: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarIssues(obraId)
  return useMutation({ mutationFn: (topicos: TopicoBcf[]) => repo.importarBcf(obraId, topicos), onSuccess: invalidar })
}

/** URL de leitura da imagem de uma vista; sem caminho, não busca. */
export function useUrlImagemVista(caminho: string | null) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'issues', 'imagem', caminho],
    queryFn: () => repo.urlImagemVista(caminho as string),
    enabled: caminho !== null,
    staleTime: 5 * 60_000,
  })
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
