/**
 * Wrapper mínimo e tipado sobre `window.Telegram.WebApp`.
 * Em navegador comum (sem Telegram) todas as funções retornam valores neutros
 * e não fazem nada, para que o app possa ser desenvolvido fora do Telegram.
 */

export interface TelegramBackButton {
  show(): void
  hide(): void
  onClick(callback: () => void): void
  offClick(callback: () => void): void
}

export interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  [chave: string]: string | undefined
}

export interface TelegramWebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  BackButton: TelegramBackButton
  ready(): void
  expand(): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

function webApp(): TelegramWebApp | undefined {
  return typeof window === 'undefined' ? undefined : window.Telegram?.WebApp
}

/** True quando o app está rodando dentro do Telegram. */
export function dentroDoTelegram(): boolean {
  return webApp() !== undefined
}

/** Avisa o Telegram que a interface está pronta. */
export function ready(): void {
  webApp()?.ready()
}

/** Expande o Mini App para a altura máxima. */
export function expand(): void {
  webApp()?.expand()
}

/** `initData` bruto a ser validado no servidor; string vazia fora do Telegram. */
export function initData(): string {
  return webApp()?.initData ?? ''
}

/** Esquema de cores do Telegram; fora dele, segue o do sistema. */
export function colorScheme(): 'light' | 'dark' {
  const app = webApp()
  if (app) return app.colorScheme
  const escuro =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  return escuro ? 'dark' : 'light'
}

/** Cores do tema do Telegram; objeto vazio fora dele. */
export function themeParams(): TelegramThemeParams {
  return webApp()?.themeParams ?? {}
}

/** Botão Voltar nativo; fora do Telegram, as funções não fazem nada. */
export const BackButton: TelegramBackButton = {
  show: () => webApp()?.BackButton.show(),
  hide: () => webApp()?.BackButton.hide(),
  onClick: (callback) => webApp()?.BackButton.onClick(callback),
  offClick: (callback) => webApp()?.BackButton.offClick(callback),
}
