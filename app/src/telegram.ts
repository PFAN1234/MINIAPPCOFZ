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

/** Dados de `LocationManager.getLocation` (Bot API 8.0+). */
export interface TelegramLocalizacao {
  latitude: number
  longitude: number
  horizontal_accuracy?: number | null
}

/** `WebApp.LocationManager` (Bot API 8.0+). */
export interface TelegramLocationManager {
  isInited: boolean
  isLocationAvailable: boolean
  isAccessRequested: boolean
  isAccessGranted: boolean
  init(callback?: () => void): void
  /** Pede a posição (e a permissão, se faltar); o callback recebe null se o acesso for negado. */
  getLocation(callback: (dados: TelegramLocalizacao | null) => void): void
  openSettings(): void
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
  /** Versão da Bot API do cliente (ex.: '7.10'). */
  version?: string
  isVersionAtLeast?(versao: string): boolean
  /** Cor do cabeçalho do Telegram. Hex só a partir da 6.9 (de 6.1 a 6.8, só 'bg_color' ou 'secondary_bg_color'). */
  setHeaderColor?(cor: string): void
  /** Cor de fundo do Mini App (6.1+). */
  setBackgroundColor?(cor: string): void
  /** Cor da barra inferior do Telegram (7.10+). */
  setBottomBarColor?(cor: string): void
  /** Plataforma do cliente: 'ios', 'android', 'android_x', 'tdesktop', 'macos', 'weba', 'webk'... */
  platform?: string
  /** Impede que arrastar para baixo feche ou minimize o Mini App (7.7+). */
  disableVerticalSwipes?(): void
  /** Ocupa a tela inteira, sem o cabeçalho do Telegram (8.0+). */
  requestFullscreen?(): void
  /** Localização do aparelho (8.0+). */
  LocationManager?: TelegramLocationManager
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

/** Plataformas em que o app abre em tela cheia (no computador, tela cheia tomaria o monitor todo). */
const PLATAFORMAS_CELULAR = new Set(['ios', 'android', 'android_x'])

/** Chama um método do cliente só se a versão aceitar; erro do cliente não derruba o app. */
function pedirSeAceitar(app: TelegramWebApp, versaoMinima: string, metodo: (() => void) | undefined) {
  try {
    if (typeof metodo !== 'function' || typeof app.isVersionAtLeast !== 'function') return
    if (!app.isVersionAtLeast(versaoMinima)) return
    metodo.call(app)
  } catch {
    /* cliente antigo ou fora do Telegram: fica o comportamento padrão */
  }
}

/**
 * Trava o arrasto para baixo (só rola a página; fechar fica no X) e, no celular, abre em tela cheia.
 * O espaço da barra de status e dos botões flutuantes do Telegram vem em `--seguro-topo` (tokens.css).
 */
export function telaCheia(): void {
  const app = webApp()
  if (!app) return
  pedirSeAceitar(app, '7.7', app.disableVerticalSwipes)
  if (PLATAFORMAS_CELULAR.has(app.platform ?? '')) pedirSeAceitar(app, '8.0', app.requestFullscreen)
}

/** Cores que o app pede ao Telegram (as mesmas de `estilo/tokens.css`: --azul, --fundo, --superficie). */
export const CORES_TELEGRAM = {
  cabecalho: '#0B1625',
  fundo: '#ECEFF3',
  barraInferior: '#FFFFFF',
} as const

/** Pede uma cor só se o cliente tiver a versão mínima; erro do cliente não derruba o app. */
function pedirCor(app: TelegramWebApp, versaoMinima: string, metodo: ((cor: string) => void) | undefined, cor: string) {
  try {
    if (typeof metodo !== 'function' || typeof app.isVersionAtLeast !== 'function') return
    if (!app.isVersionAtLeast(versaoMinima)) return
    metodo.call(app, cor)
  } catch {
    /* cliente antigo ou fora do Telegram: fica a cor padrão do Telegram */
  }
}

/**
 * Pinta o cabeçalho, o fundo e a barra inferior do Telegram com as cores do app (tema sempre claro,
 * topo azul-escuro). Cada cor só é pedida quando a versão do cliente aceita; chamada uma vez ao abrir.
 */
export function aplicarCoresTelegram(): void {
  const app = webApp()
  if (!app) return
  pedirCor(app, '6.9', app.setHeaderColor, CORES_TELEGRAM.cabecalho)
  pedirCor(app, '6.1', app.setBackgroundColor, CORES_TELEGRAM.fundo)
  pedirCor(app, '7.10', app.setBottomBarColor, CORES_TELEGRAM.barraInferior)
}

/**
 * `LocationManager` do Telegram, só se o cliente tiver a Bot API 8.0+ (senão undefined e o
 * chamador usa o GPS do navegador). Erro do cliente não derruba o app.
 */
export function localizacaoDoTelegram(): TelegramLocationManager | undefined {
  try {
    const app = webApp()
    if (!app || !dentroDoTelegram()) return undefined
    if (typeof app.isVersionAtLeast !== 'function' || !app.isVersionAtLeast('8.0')) return undefined
    return app.LocationManager
  } catch {
    return undefined
  }
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
