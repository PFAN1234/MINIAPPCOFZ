import { useState } from 'react'
import { FUSO_PADRAO, dataNoFuso, formatarDia, horaNoFuso } from '../util/fuso.ts'

export interface Versao {
  pr: number | null
  commit: string | null
  data: string
}

/** "v39 · 13/11" (sem PR, o commit curto no lugar do número). */
export function rotuloVersao(v: Versao): string {
  const dia = formatarDia(dataNoFuso(new Date(v.data), FUSO_PADRAO)).slice(0, 5)
  const nome = v.pr !== null ? `v${v.pr}` : (v.commit ?? 'dev')
  return `${nome} · ${dia}`
}

/** Duas linhas: "Versão 39 · commit 9e969c1" e "13/11/2026 14:32". */
export function detalheVersao(v: Versao): [string, string] {
  const nome = v.pr !== null ? `Versão ${v.pr}` : 'Versão sem PR'
  const primeira = v.commit ? `${nome} · commit ${v.commit}` : nome
  return [primeira, `${formatarDia(dataNoFuso(new Date(v.data), FUSO_PADRAO))} ${horaNoFuso(v.data, FUSO_PADRAO)}`]
}

/** Etiqueta discreta da versão no canto da faixa de identidade; um toque mostra o commit e a hora. */
export function SeloVersao({ versao = __VERSAO_APP__ }: { versao?: Versao }) {
  const [aberto, setAberto] = useState(false)
  return (
    <button
      type="button"
      className="selo-versao"
      aria-expanded={aberto}
      aria-label={aberto ? undefined : `Versão do app: ${rotuloVersao(versao)}`}
      onClick={() => setAberto((a) => !a)}
    >
      {aberto
        ? detalheVersao(versao).map((linha) => (
            <span key={linha} className="selo-versao-linha">
              {linha}
            </span>
          ))
        : rotuloVersao(versao)}
    </button>
  )
}
