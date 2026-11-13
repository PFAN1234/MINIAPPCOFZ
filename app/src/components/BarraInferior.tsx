import type { ComponentType } from 'react'
import { NavLink } from 'react-router'
import { IconeCasa, IconeLista } from './Icones.tsx'

interface Item {
  para: string
  rotulo: string
  fim: boolean
  Icone: ComponentType<{ tamanho?: number }>
}

const ITENS: Item[] = [
  { para: '/', rotulo: 'Início', fim: true, Icone: IconeCasa },
  { para: '/registros', rotulo: 'Registros', fim: false, Icone: IconeLista },
]

/** Abas fixas no rodapé. O item da tela atual leva `aria-current="page"` (posto pelo NavLink). */
export function BarraInferior() {
  return (
    <nav className="barra-inferior" aria-label="Navegação principal">
      {ITENS.map(({ para, rotulo, fim, Icone }) => (
        <NavLink key={para} to={para} end={fim} className="barra-item">
          <Icone tamanho={26} />
          <span className="barra-rotulo">{rotulo}</span>
        </NavLink>
      ))}
    </nav>
  )
}
