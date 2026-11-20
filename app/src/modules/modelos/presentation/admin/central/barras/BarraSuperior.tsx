import { useState } from 'react'
import type { ModoCor } from '../../../../domain/central.ts'

/** Botões ainda desabilitados (ganham função nas próximas etapas). */
const BOTOES_FUTUROS = ['Modelos', 'Issues', 'Medir', 'Cortar', 'Captura', 'Obra']

const MODOS: { id: ModoCor; nome: string }[] = [
  { id: 'nenhum', nome: 'Nenhuma' },
  { id: 'categoria', nome: 'Categoria' },
  { id: 'disciplina', nome: 'Disciplina' },
]

interface Props {
  /** Habilita Enquadrar, Projeção, Cor e Grade (motor pronto). */
  ativo: boolean
  ortografica: boolean
  cor: ModoCor
  grade: boolean
  onEnquadrar(): void
  onProjecao(): void
  onCor(modo: ModoCor): void
  onGrade(): void
}

/** Barra superior do visualizador: enquadrar (F), projeção, cor por categoria/disciplina e grade. */
export default function BarraSuperior({ ativo, ortografica, cor, grade, onEnquadrar, onProjecao, onCor, onGrade }: Props) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="central-barra central-barra-superior" role="toolbar" aria-label="Ferramentas do visualizador">
      <button
        type="button"
        className="central-botao"
        aria-label="Enquadrar"
        title="Enquadrar (F)"
        disabled={!ativo}
        onClick={onEnquadrar}
      >
        Enquadrar
      </button>
      <button
        type="button"
        className="central-botao"
        aria-label="Projeção"
        title={ortografica ? 'Projeção ortográfica' : 'Projeção em perspectiva'}
        aria-pressed={ortografica}
        disabled={!ativo}
        onClick={onProjecao}
      >
        Projeção
      </button>
      <div className="central-menu">
        <button
          type="button"
          className="central-botao"
          aria-label="Cor"
          title="Colorir por"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-pressed={cor !== 'nenhum'}
          disabled={!ativo}
          onClick={() => setMenu((m) => !m)}
        >
          Cor
        </button>
        {menu && (
          <div role="menu" aria-label="Colorir por" className="central-menu-lista">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={cor === m.id}
                className="central-botao"
                onClick={() => {
                  onCor(m.id)
                  setMenu(false)
                }}
              >
                {m.nome}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="central-botao"
        aria-label="Grade"
        title="Mostrar ou ocultar a grade"
        aria-pressed={grade}
        disabled={!ativo}
        onClick={onGrade}
      >
        Grade
      </button>
      {BOTOES_FUTUROS.map((nome) => (
        <button key={nome} type="button" className="central-botao" aria-label={nome} aria-pressed="false" disabled>
          {nome}
        </button>
      ))}
    </div>
  )
}
