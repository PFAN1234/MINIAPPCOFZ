import { NavLink } from 'react-router'

const ITENS = [
  { para: '/', rotulo: 'Início', fim: true },
  { para: '/registros', rotulo: 'Registros', fim: false },
  { para: '/pendencias', rotulo: 'Pendências', fim: false },
]

export function BarraInferior() {
  return (
    <nav className="barra-inferior" aria-label="Navegação principal">
      {ITENS.map((i) => (
        <NavLink key={i.para} to={i.para} end={i.fim} className="barra-item">
          {i.rotulo}
        </NavLink>
      ))}
    </nav>
  )
}
