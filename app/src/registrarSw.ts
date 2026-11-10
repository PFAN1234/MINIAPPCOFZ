/** Mensagem que pede ao service worker para conferir se há versão nova do app. */
export const MSG_VERIFICAR_ATUALIZACAO = 'verificar-atualizacao'

/** Registra o service worker (cache do app, plantas e fotos). Somente em produção. */
export function registrarSw(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const container = navigator.serviceWorker

  const verificar = (registro?: ServiceWorkerRegistration) => {
    try {
      const alvo = container.controller ?? registro?.active
      alvo?.postMessage(MSG_VERIFICAR_ATUALIZACAO)
    } catch {
      /* sem verificação agora; tenta na próxima vez */
    }
  }

  window.addEventListener('load', () => {
    container
      .register('/sw.js')
      .then((registro) => {
        verificar(registro)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') verificar(registro)
        })
      })
      .catch(() => {
        /* sem cache offline; o app segue funcionando */
      })
  })
}
