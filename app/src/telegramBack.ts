import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BackButton, dentroDoTelegram } from './telegram.ts'

/** Volta no histórico; se a tela foi aberta direto (sem histórico), vai para o início. */
export function useVoltar(): () => void {
  const navigate = useNavigate()
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/', { replace: true })
  }
}

/** Mostra o BackButton do Telegram fora de `/` e volta no histórico ao tocar. */
export function useBackButtonTelegram(): void {
  const { pathname } = useLocation()
  const voltar = useVoltar()
  const naRaiz = pathname === '/'

  useEffect(() => {
    if (naRaiz) {
      BackButton.hide()
      return
    }
    BackButton.show()
    BackButton.onClick(voltar)
    return () => BackButton.offClick(voltar)
  })

  useEffect(() => () => BackButton.hide(), [])
}

export { dentroDoTelegram }
