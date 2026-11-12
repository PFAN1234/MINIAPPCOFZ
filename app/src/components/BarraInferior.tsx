import type { ComponentType } from 'react'
import { NavLink } from 'react-router'
import { useTotalPendenciasAbertas } from '../dados/hooks.ts'
import { IconeAlerta, IconeCasa, IconeLista } from './Icones.tsx'

interface Item {
  para: string
  rotulo: string
  fim: boolean
  Icone: ComponentType<{ tamanho?: number }>
}

const ITENS: Item[] = [
  { para: '/', rotulo: 'Início', fim: true, Icone: IconeCasa },
  { para: '/registros', rotulo: 'Registros', fim: false, Icone: IconeLista },
  { para: '/pendencias', rotulo: 'Pendências', fim: false, Icone: IconeAlerta },
]

/** Abas fixas no rodapé. O item da tela atual leva `aria-current="page"` (posto pelo NavLink). */
export function BarraInferior() {
  const abertas = useTotalPendenciasAbertas()
  return (
    <nav className="barra-inferior" aria-label="Navegação principal">
      {ITENS.map(({ para, rotulo, fim, Icone }) => (
        <NavLink key={para} to={para} end={fim} className="barra-item">
          <Icone tamanho={26} />
          <span className="barra-rotulo">
            {rotulo}
            {para === '/pendencias' && abertas ? (
              <>
                {` · ${abertas} `}
                <span className="sr-only">abertas</span>
              </>
            ) : null}
          </span>
        </NavLink>
      ))}
    </nav>
  )
}
