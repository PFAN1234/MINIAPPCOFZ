import { useState } from 'react'
import { FUSO_PADRAO, dataNoFuso, formatarDia, horaNoFuso } from '../util/fuso.ts'

export interface Versao {
  pr: number | null
  commit: string | null
  data: string
}

/** "v40.261113.58182c8": PR, data do build (aammdd, fuso de Brasília) e commit curto. Sem PR, "vdev". */
export function rotuloVersao(v: Versao): string {
  const aammdd = dataNoFuso(new Date(v.data), FUSO_PADRAO).slice(2).replaceAll('-', '')
  const partes = [v.pr !== null ? `v${v.pr}` : 'vdev', aammdd]
  if (v.commit) partes.push(v.commit)
  return partes.join('.')
}

/** Duas linhas: a versão e "Publicada em 13/11/2026 14:32". */
export function detalheVersao(v: Versao): [string, string] {
  const quando = `${formatarDia(dataNoFuso(new Date(v.data), FUSO_PADRAO))} ${horaNoFuso(v.data, FUSO_PADRAO)}`
  return [rotuloVersao(v), `Publicada em ${quando}`]
}

/** Etiqueta discreta da versão no canto da faixa de identidade; um toque mostra a data e a hora da publicação. */
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
