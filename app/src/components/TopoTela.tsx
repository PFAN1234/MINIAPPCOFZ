import { useContext, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { dentroDoTelegram } from '../telegram.ts'
import { useVoltar } from '../telegramBack.ts'
import { podeSair } from '../util/guardaSaida.ts'
import { FaixaDoTopo } from './faixaDoTopo.ts'
import { MarcaOM } from './FaixaIdentidade.tsx'
import { IconeVoltar } from './Icones.tsx'
import { SeloVersao } from './SeloVersao.tsx'

/**
 * O título divide a linha com a assinatura e a versão: quanto mais letras, menor a letra. Nome
 * comprido quebra a linha, nunca vira reticências.
 */
const TITULO_MEDIO = 6
const TITULO_LONGO = 10
const TITULO_MUITO_LONGO = 24

interface Props {
  /** Título da tela: vira o `h1`. */
  titulo: string
  /** Linha de contexto abaixo da faixa (pode ter links, como a obra no subtítulo do ambiente). */
  subtitulo?: ReactNode
  /** Linha pequena acima do título, no centro da faixa. */
  sobretitulo?: ReactNode
  /**
   * Destino (rota ou função) do "Voltar" fora do Telegram. Sem ele, o "Voltar" aparece em toda
   * tela fora do início e volta no histórico, como o BackButton do Telegram.
   */
  voltar?: string | (() => void)
  /** `id` do `h1`, para o `aria-labelledby` da seção da tela. */
  idTitulo?: string
  /** Linha da base do topo: abas (etapas, pavimentos) à esquerda e atalhos à direita. As abas rolam na horizontal se não couberem. */
  base?: ReactNode
  /** Ações no topo (botões, seletor de pavimento). */
  children?: ReactNode
}

/**
 * Topo azul de cada tela, emendado com o cabeçalho do Telegram (também azul). Uma linha só: a
 * assinatura (brasão, OM e "Fiscal Bot") à esquerda, o título no centro e a versão do app à
 * direita. Abaixo, se houver, o subtítulo e a linha da base (abas e atalhos). Dentro do Telegram,
 * quem volta é o BackButton nativo (ver `Layout` e `telegramBack.ts`); fora dele, o "Voltar" fica
 * aqui. A faixa de envio e de sem sinal vem logo abaixo, nunca acima do azul.
 */
export function TopoTela({
  titulo,
  subtitulo,
  sobretitulo,
  voltar,
  idTitulo,
  base,
  children,
}: Props) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const voltarNoHistorico = useVoltar()
  const faixa = useContext(FaixaDoTopo)

  const comVoltar = !dentroDoTelegram() && (voltar !== undefined || pathname !== '/')
  const letras = titulo.length
  const tamanho =
    letras > TITULO_MUITO_LONGO
      ? 'muito-longo'
      : letras > TITULO_LONGO
        ? 'longo'
        : letras > TITULO_MEDIO
          ? 'medio'
          : undefined

  function aoVoltar() {
    if (typeof voltar === 'function') voltar()
    else if (typeof voltar === 'string') {
      if (podeSair()) navigate(voltar)
    } else voltarNoHistorico()
  }

  return (
    <div className="topo">
      <header className="topo-tela">
        <div className="topo-faixa">
          <MarcaOM />
          <div className="topo-centro">
            {sobretitulo && <p className="topo-sobretitulo">{sobretitulo}</p>}
            <h1 id={idTitulo} className="topo-titulo" data-tamanho={tamanho}>
              {titulo}
            </h1>
          </div>
          <SeloVersao />
        </div>
        {comVoltar && (
          <button type="button" className="topo-voltar" onClick={aoVoltar}>
            <IconeVoltar tamanho={22} />
            Voltar
          </button>
        )}
        {subtitulo && <p className="topo-subtitulo">{subtitulo}</p>}
        {children && <div className="topo-acoes">{children}</div>}
        {base && <div className="topo-base">{base}</div>}
      </header>
      {faixa}
    </div>
  )
}
