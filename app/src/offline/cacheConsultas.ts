/** Persistência do cache do react-query no armazenamento local, por usuário. */
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import type { Armazenamento } from './armazenamento.ts'

/**
 * Sobe sempre que o formato de uma consulta guardada muda: o cache antigo é descartado ao abrir.
 * 2: obras com `etapa` (etapas, 2026-11-12).
 */
export const VERSAO_CACHE = 2
export const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60_000
const ATRASO_GRAVACAO_MS = 1000
const FORA_DO_CACHE = ['sessao', 'usuario', 'obras-disponiveis', 'solicitacoes']

/** URLs `blob:` só valem na página que as criou; não adianta guardá-las. */
function temUrlDeObjeto(dados: unknown): boolean {
  return (
    typeof dados === 'object' &&
    dados !== null &&
    Object.values(dados).some((v) => typeof v === 'string' && v.startsWith('blob:'))
  )
}

export async function restaurarCache(
  qc: QueryClient,
  a: Armazenamento,
  usuarioId: string,
): Promise<void> {
  try {
    const salvo = await a.lerCache(usuarioId)
    if (
      salvo &&
      salvo.versao === VERSAO_CACHE &&
      Date.now() - salvo.salvoEm <= IDADE_MAXIMA_MS
    ) {
      hydrate(qc, salvo.estado as DehydratedState)
      // O cache serve para mostrar algo na hora (ou sem sinal), mas pode ser
      // anterior a um envio: marca como vencido para ser refeito ao montar.
      // As imagens ficam como estão (a URL antiga ainda serve pelo SW).
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== 'imagens',
        refetchType: 'none',
      })
    }
  } catch {
    // Cache ilegível: o app segue sem ele.
  }
  try {
    await a.limparCachesExceto(usuarioId)
  } catch {
    // Limpeza é só higiene.
  }
}

export function persistirCache(qc: QueryClient, a: Armazenamento, usuarioId: string): () => void {
  let temporizador: ReturnType<typeof setTimeout> | null = null

  async function gravar(): Promise<void> {
    try {
      const estado = dehydrate(qc, {
        shouldDehydrateQuery: (q) =>
          q.state.status === 'success' &&
          !FORA_DO_CACHE.includes(String(q.queryKey[0])) &&
          !(q.queryKey[0] === 'imagens' && temUrlDeObjeto(q.state.data)),
      })
      await a.salvarCache(usuarioId, { versao: VERSAO_CACHE, salvoEm: Date.now(), estado })
    } catch {
      // Falha de gravação não derruba o app.
    }
  }

  const cancelarAssinatura = qc.getQueryCache().subscribe(() => {
    if (temporizador !== null) clearTimeout(temporizador)
    temporizador = setTimeout(() => {
      temporizador = null
      void gravar()
    }, ATRASO_GRAVACAO_MS)
  })

  // O app pode ser fechado a qualquer momento: grava já ao ir para segundo plano.
  const gravarAgora = () => {
    if (temporizador === null) return
    clearTimeout(temporizador)
    temporizador = null
    void gravar()
  }
  const aoMudarVisibilidade = () => {
    if (document.visibilityState === 'hidden') gravarAgora()
  }
  window.addEventListener('pagehide', gravarAgora)
  document.addEventListener('visibilitychange', aoMudarVisibilidade)

  return () => {
    if (temporizador !== null) clearTimeout(temporizador)
    temporizador = null
    cancelarAssinatura()
    window.removeEventListener('pagehide', gravarAgora)
    document.removeEventListener('visibilitychange', aoMudarVisibilidade)
  }
}
