import { useSyncExternalStore } from 'react'

function assinar(fn: () => void): () => void {
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => {
    window.removeEventListener('online', fn)
    window.removeEventListener('offline', fn)
  }
}

/** True enquanto o aparelho tem conexão. */
export function useOnline(): boolean {
  return useSyncExternalStore(assinar, () => navigator.onLine)
}
