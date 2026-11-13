import { useContext, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { dentroDoTelegram } from '../telegram.ts'
import { useVoltar } from '../telegramBack.ts'
import { podeSair } from '../util/guardaSaida.ts'
import { FaixaDoTopo } from './faixaDoTopo.ts'
import { FaixaIdentidade } from './FaixaIdentidade.tsx'
import { IconeVoltar } from './Icones.tsx'

/** A partir de quantas letras o título diminui. Nome longo quebra a linha, nunca vira reticências. */
const TITULO_LONGO = 20
const TITULO_MUITO_LONGO = 40

interface Props {
  /** Título da tela: vira o `h1`. */
  titulo: string
  /** Linha abaixo do título (pode ter links, como a obra no subtítulo do ambiente). */
  subtitulo?: ReactNode
  /** Linha pequena acima do título. */
  sobretitulo?: ReactNode
  /**
   * Destino (rota ou função) do "Voltar" fora do Telegram. Sem ele, o "Voltar" aparece em toda
   * tela fora do início e volta no histórico, como o BackButton do Telegram.
   */
  voltar?: string | (() => void)
  /** Tela de lista (Início, Registros, Pendências): título em maiúsculas. */
  lista?: boolean
  /** `id` do `h1`, para o `aria-labelledby` da seção da tela. */
  idTitulo?: string
  /** À direita do título, na mesma linha (abas, botão). Se não couber, rola na horizontal; o título não quebra a linha dele. */
  aoLado?: ReactNode
  /** Ações no topo (botões, seletor de pavimento). */
  children?: ReactNode
}

/**
 * Topo azul de cada tela, emendado com o cabeçalho do Telegram (também azul), com a faixa de
 * identidade (logo e nome da OM, "Fiscal Bot") no alto. Dentro do
 * Telegram, quem volta é o BackButton nativo (ver `Layout` e `telegramBack.ts`); fora dele, o
 * "Voltar" fica aqui. A faixa de envio e de sem sinal vem logo abaixo, nunca acima do azul.
 */
export function TopoTela({ titulo, subtitulo, sobretitulo, voltar, lista = false, idTitulo, aoLado, children }: Props) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const voltarNoHistorico = useVoltar()
  const faixa = useContext(FaixaDoTopo)

  const comVoltar = !dentroDoTelegram() && (voltar !== undefined || pathname !== '/')
  const tamanho =
    titulo.length > TITULO_MUITO_LONGO ? 'muito-longo' : titulo.length > TITULO_LONGO ? 'longo' : undefined

  function aoVoltar() {
    if (typeof voltar === 'function') voltar()
    else if (typeof voltar === 'string') {
      if (podeSair()) navigate(voltar)
    } else voltarNoHistorico()
  }

  return (
    <div className="topo">
      <header className={lista ? 'topo-tela topo-lista' : 'topo-tela'}>
        <FaixaIdentidade />
        {comVoltar && (
          <button type="button" className="topo-voltar" onClick={aoVoltar}>
            <IconeVoltar tamanho={24} />
            Voltar
          </button>
        )}
        {sobretitulo && <p className="topo-sobretitulo">{sobretitulo}</p>}
        {aoLado ? (
          <div className="topo-linha-titulo">
            <h1 id={idTitulo} className="topo-titulo" data-tamanho={tamanho}>
              {titulo}
            </h1>
            <div className="topo-ao-lado">{aoLado}</div>
          </div>
        ) : (
          <h1 id={idTitulo} className="topo-titulo" data-tamanho={tamanho}>
            {titulo}
          </h1>
        )}
        {subtitulo && <p className="topo-subtitulo">{subtitulo}</p>}
        {children && <div className="topo-acoes">{children}</div>}
      </header>
      {faixa}
    </div>
  )
}
