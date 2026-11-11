import { useEffect, useRef, useState } from 'react'
import { mensagemDe } from '../componentes.tsx'
import { useRepositorioAdmin } from '../dados/contexto.tsx'
import type { DadosWidget, UsuarioSessao } from '../dados/tipos.ts'

/** Script oficial do Telegram Login Widget (https://core.telegram.org/widgets/login). */
export const URL_WIDGET = 'https://telegram.org/js/telegram-widget.js?22'

declare global {
  interface Window {
    onTelegramAuth?: (dados: DadosWidget) => void
  }
}

/** Nome do bot (sem @) para o widget: `VITE_TELEGRAM_BOT`. */
export function nomeDoBot(): string {
  return String(import.meta.env.VITE_TELEGRAM_BOT ?? '').replace(/^@/, '').trim()
}

/**
 * Insere o botão do Telegram. O domínio do site precisa estar no bot (`/setdomain` no
 * BotFather); senão o Telegram mostra "Bot domain invalid".
 */
export function WidgetTelegram({ bot, onAuth }: { bot: string; onAuth: (d: DadosWidget) => void }) {
  const caixa = useRef<HTMLDivElement>(null)
  const retorno = useRef(onAuth)
  useEffect(() => {
    retorno.current = onAuth
  }, [onAuth])

  useEffect(() => {
    const alvo = caixa.current
    if (!alvo) return
    window.onTelegramAuth = (d) => retorno.current(d)
    const s = document.createElement('script')
    s.src = URL_WIDGET
    s.async = true
    s.setAttribute('data-telegram-login', bot)
    s.setAttribute('data-size', 'large')
    s.setAttribute('data-userpic', 'false')
    s.setAttribute('data-lang', 'pt-br')
    s.setAttribute('data-onauth', 'onTelegramAuth(user)')
    alvo.appendChild(s)
    return () => {
      alvo.replaceChildren()
      delete window.onTelegramAuth
    }
  }, [bot])

  return <div ref={caixa} className="adm-widget" data-testid="widget-telegram" />
}

interface Props {
  /** Erro ao trocar o link `#entrar=` (inválido, expirado ou já usado). */
  erroEntrada: string | null
  onEntrou: () => void
}

export function Entrar({ erroEntrada, onEntrou }: Props) {
  const repo = useRepositorioAdmin()
  const [erro, setErro] = useState<string | null>(erroEntrada)
  const [entrando, setEntrando] = useState(false)
  const bot = nomeDoBot()

  async function tentar(f: () => Promise<void>) {
    setEntrando(true)
    setErro(null)
    try {
      await f()
      onEntrou()
    } catch (e) {
      setErro(mensagemDe(e, 'Não foi possível entrar.'))
    } finally {
      setEntrando(false)
    }
  }

  return (
    <main className="adm-entrada">
      <h1>Administração do Diário da obra</h1>
      <p>Entre com a sua conta do Telegram. Só admins do Mini App têm acesso.</p>
      {erro && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {erro}
        </p>
      )}
      {entrando && <p role="status">Entrando…</p>}
      {bot ? (
        <WidgetTelegram bot={bot} onAuth={(d) => void tentar(() => repo.entrarComWidget(d))} />
      ) : (
        <p className="adm-dica">Login pelo Telegram não configurado neste ambiente (VITE_TELEGRAM_BOT).</p>
      )}
      {repo.entrarModoTeste && (
        <button type="button" className="adm-botao" onClick={() => void tentar(() => repo.entrarModoTeste!())}>
          Entrar como teste
        </button>
      )}
      <p className="adm-dica">ou use o botão Administração no Mini App, que abre este site já com a sessão.</p>
    </main>
  )
}

export function AcessoNegado({ usuario, onSair }: { usuario: UsuarioSessao; onSair: () => void }) {
  return (
    <main className="adm-entrada">
      <h1>Acesso negado</h1>
      <p>
        {usuario.nome ? `${usuario.nome}, sua` : 'Sua'} conta não é admin do Mini App. Peça a um admin para incluir
        você na página Admins.
      </p>
      <button type="button" className="adm-botao" onClick={onSair}>
        Sair
      </button>
    </main>
  )
}
