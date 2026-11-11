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
  /** Dados já decodificados (não confiáveis; a validação é feita no servidor). */
  initDataUnsafe?: { user?: { id?: number }; start_param?: string }
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  BackButton: TelegramBackButton
  ready(): void
  expand(): void
  enableClosingConfirmation(): void
  disableClosingConfirmation(): void
  /** Abre o link no navegador externo (Bot API 6.1+). */
  openLink?(url: string): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

function webApp(): TelegramWebApp | undefined {
  return typeof window === 'undefined' ? undefined : window.Telegram?.WebApp
}

/**
 * True quando o app está rodando dentro do Telegram. O `telegram-web-app.js`
 * define `window.Telegram.WebApp` até em navegador comum, mas só dentro do
 * Telegram o `initData` vem preenchido.
 */
export function dentroDoTelegram(): boolean {
  const app = webApp()
  return app !== undefined && app.initData !== ''
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

/** Id do usuário no Telegram; null fora dele. */
export function idUsuarioTelegram(): number | null {
  const id = webApp()?.initDataUnsafe?.user?.id
  return typeof id === 'number' ? id : null
}

/** Parâmetro do link `startapp` com que o Mini App foi aberto; null se não houver. */
export function parametroInicial(): string | null {
  const p = webApp()?.initDataUnsafe?.start_param
  return typeof p === 'string' && p !== '' ? p : null
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

/** Pede confirmação antes de o Telegram fechar o Mini App; sem efeito fora dele. */
export function enableClosingConfirmation(): void {
  webApp()?.enableClosingConfirmation()
}

export function disableClosingConfirmation(): void {
  webApp()?.disableClosingConfirmation()
}

/**
 * Abre um link no navegador: dentro do Telegram, pelo `openLink` (sai do Mini App);
 * fora dele, numa nova aba.
 */
export function abrirLink(url: string): void {
  const app = webApp()
  if (dentroDoTelegram() && typeof app?.openLink === 'function') {
    app.openLink(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}
