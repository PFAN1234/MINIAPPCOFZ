import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositorioAdmin } from './contexto.tsx'
import type { ConfigObra, DadosAditivo, DadosEtapa, DadosObra, PavimentoResumo, QrAmbiente } from './tipos.ts'

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

// --- Etapas ------------------------------------------------------------------------------------

export function useEtapas() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'etapas'], queryFn: () => repo.listarEtapas() })
}

/** Etapas e obras andam juntas (contagens, etapa de cada obra): relê tudo do admin. */
export function useSalvarEtapa() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (d: DadosEtapa) => repo.salvarEtapa(d), onSuccess: invalidar })
}

/** Cadastro completo da etapa (`admin_obter_etapa`): aditivos, responsáveis, prazo e o que falta. */
export function useEtapa(slug: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'etapa', slug], queryFn: () => repo.obterEtapa(slug) })
}

export function useSalvarAditivo() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (d: DadosAditivo) => repo.salvarAditivo(d), onSuccess: invalidar })
}

export function useRemoverAditivo() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (id: string) => repo.removerAditivo(id), onSuccess: invalidar })
}

export function useDefinirResponsaveis(etapaId: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({
    mutationFn: (lista: { usuario_id: string; funcao: string }[]) => repo.definirResponsaveis(etapaId, lista),
    onSuccess: invalidar,
  })
}

/** Estações do INMET perto do ponto; só consulta com coordenadas válidas. */
export function useSugestoesEstacoes(ponto: { latitude: number; longitude: number } | null) {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['admin', 'estacoes', ponto?.latitude ?? null, ponto?.longitude ?? null],
    queryFn: () => repo.sugerirEstacoes(ponto!.latitude, ponto!.longitude),
    enabled: ponto !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

// --- Pessoas -----------------------------------------------------------------------------------

export function usePessoas() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'pessoas'], queryFn: () => repo.listarPessoas() })
}

/** Os nomes aparecem também nos responsáveis das etapas: relê tudo do admin. */
export function useDefinirNomeExibicao() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({
    mutationFn: (p: { id: string; nome: string | null }) => repo.definirNomeExibicao(p.id, p.nome),
    onSuccess: invalidar,
  })
}

export function useArquivarEtapa(slug: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (arquivada: boolean) => repo.arquivarEtapa(slug, arquivada), onSuccess: invalidar })
}

export function useDesvincularEtapa(slug: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: () => repo.desvincularEtapa(slug), onSuccess: invalidar })
}

export function useResumoEtapa(slug: string, ativo: boolean) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'resumo-etapa', slug], queryFn: () => repo.resumoEtapa(slug), enabled: ativo })
}

export function useExcluirEtapa(slug: string) {
  const repo = useRepositorioAdmin()
  return useMutation({ mutationFn: (confirmacao: string) => repo.excluirEtapa(slug, confirmacao) })
}

// --- Organização -------------------------------------------------------------------------------

/**
 * Nome e logo da OM. Fora do prefixo `admin`: vale também na tela de entrada e não sai ao
 * trocar de sessão. Sem novas tentativas: quem usa cai para só "Fiscal Bot" se falhar.
 */
export function useOrganizacao() {
  const repo = useRepositorioAdmin()
  return useQuery({
    queryKey: ['organizacao'],
    queryFn: () => repo.obterOrganizacao(),
    retry: false,
    staleTime: 5 * 60_000,
  })
}

/** Envia o logo novo (se houver) e grava nome e logo. */
export function useSalvarOrganizacao() {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: { nome: string; logo: Blob | null; logo_path: string | null; cabecalho?: string[] }) => {
      const caminho = d.logo ? await repo.enviarLogo(d.logo) : d.logo_path
      return repo.salvarOrganizacao({ nome: d.nome, logo_path: caminho, cabecalho: d.cabecalho })
    },
    onSuccess: (org) => {
      qc.setQueryData(['organizacao'], org)
      return qc.invalidateQueries({ queryKey: ['organizacao'] })
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
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (sigla: string) => repo.retirarModelo(slug, sigla), onSuccess: invalidar })
}

export function useAmbientesRA(obraId: string) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'ra', obraId], queryFn: () => repo.listarRA(obraId) })
}

export function useDefinirQr() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({
    mutationFn: (p: { ambienteId: string; qr: QrAmbiente }) => repo.definirQr(p.ambienteId, p.qr),
    onSuccess: invalidar,
  })
}

export function useRemoverQr() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (ambienteId: string) => repo.removerQr(ambienteId), onSuccess: invalidar })
}

export function useArquivarObra(slug: string) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (arquivada: boolean) => repo.arquivarObra(slug, arquivada), onSuccess: invalidar })
}

export function useResumoObra(slug: string, ativo: boolean) {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'resumo', slug], queryFn: () => repo.resumoObra(slug), enabled: ativo })
}

export function useExcluirObra(slug: string) {
  const repo = useRepositorioAdmin()
  return useMutation({ mutationFn: (confirmacao: string) => repo.excluirObra(slug, confirmacao) })
}

export function useExclusoes() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: ['admin', 'exclusoes'], queryFn: () => repo.listarExclusoes() })
}

export function useLimparExclusao() {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarObras()
  return useMutation({ mutationFn: (id: string) => repo.limparExclusao(id), onSuccess: invalidar })
}
