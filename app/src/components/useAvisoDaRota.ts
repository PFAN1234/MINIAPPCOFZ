import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * Aviso passado no `state` da rota (por exemplo "Registro salvo no aparelho").
 * É consumido uma vez, para não reaparecer ao voltar.
 */
export function useAvisoDaRota(): { aviso: string | null; fecharAviso: () => void } {
  const navigate = useNavigate()
  const location = useLocation()
  const [aviso, setAviso] = useState<string | null>(
    (location.state as { aviso?: string } | null)?.aviso ?? null,
  )
  const fecharAviso = useCallback(() => setAviso(null), [])
  useEffect(() => {
    if ((location.state as { aviso?: string } | null)?.aviso) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }
  }, [location, navigate])
  return { aviso, fecharAviso }
}
