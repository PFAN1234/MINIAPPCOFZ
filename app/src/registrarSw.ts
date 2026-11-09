/** Registra o service worker de cache das plantas (somente em produção). */
export function registrarSw(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sem cache offline; o app segue funcionando */
    })
  })
}
