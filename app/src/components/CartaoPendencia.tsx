import { Link } from 'react-router'
import { useUrlsImagens } from '../dados/hooks.ts'
import type { RegistroResumo } from '../dados/tipos.ts'
import { formatarDataHora, formatarRelativo } from '../util/formato.ts'
import { IconeChevron } from './Icones.tsx'

export function SeloSituacao({ situacao }: { situacao: RegistroResumo['situacao'] }) {
  return situacao === 'resolvida' ? (
    <span className="selo selo-resolvida">Resolvida</span>
  ) : (
    <span className="selo selo-aberta">Aberta</span>
  )
}

/** Cartão de uma pendência da lista (tela 5): miniatura, local, legenda, selo, data e chevron. */
export function CartaoPendencia({ registro }: { registro: RegistroResumo }) {
  const primeira = registro.fotos[0]
  const miniatura = useUrlsImagens(primeira ? [primeira.path] : [], 'fotos')
  const url = primeira ? miniatura.data?.[primeira.path] : undefined
  const local = [registro.ambiente.pavimento, registro.ambiente.nome].filter(Boolean).join(' · ')
  return (
    <li>
      <Link
        className="cartao-pendencia"
        to={`/obras/${registro.obra.slug}/pendencias/${registro.id}`}
      >
        <span className="cartao-pendencia-foto" aria-hidden="true">
          {url && <img src={url} alt="" loading="lazy" />}
        </span>
        <span className="cartao-pendencia-corpo">
          <span className="lista-sub cartao-pendencia-local">{local}</span>
          <span className="lista-titulo cartao-pendencia-legenda">{registro.legenda}</span>
          <span className="cartao-pendencia-rodape">
            <SeloSituacao situacao={registro.situacao} />
            <span className="lista-sub">
              <time dateTime={registro.capturado_em}>
                {formatarRelativo(registro.capturado_em) || formatarDataHora(registro.capturado_em)}
              </time>
            </span>
          </span>
        </span>
        <span className="cartao-pendencia-seta">
          <IconeChevron />
        </span>
      </Link>
    </li>
  )
}
