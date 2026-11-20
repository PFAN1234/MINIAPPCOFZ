import { useState } from 'react'
import type { ModoCor, Vista3dUi } from '../../../../domain/central.ts'

/** Botões ainda desabilitados (ganham função nas próximas etapas). */
const BOTOES_FUTUROS = ['Modelos', 'Issues', 'Medir', 'Captura', 'Obra']

const LADOS = ['N', 'S', 'L', 'O'] as const
const NOMES_LADO = { N: 'norte', S: 'sul', L: 'leste', O: 'oeste' }

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
  /** Nomes dos pavimentos (nós IfcBuildingStorey da árvore). */
  pavimentos: string[]
  vista: Vista3dUi
  onVista3d(): void
  onPlanta(pavimento: string): void
  onElevacao(lado: 'N' | 'S' | 'L' | 'O'): void
  /** Cria um plano de corte. */
  onCortar(): void
  cortes: number
  minimapa: boolean
  onMinimapa(): void
}

/** Barra superior do visualizador: enquadrar (F), projeção, cor por categoria/disciplina e grade. */
export default function BarraSuperior({
  ativo,
  ortografica,
  cor,
  grade,
  onEnquadrar,
  onProjecao,
  onCor,
  onGrade,
  pavimentos,
  vista,
  onVista3d,
  onPlanta,
  onElevacao,
  onCortar,
  cortes,
  minimapa,
  onMinimapa,
}: Props) {
  const [menu, setMenu] = useState(false)
  const [escolhido, setEscolhido] = useState('')
  const pavimento = pavimentos.includes(escolhido) ? escolhido : (pavimentos[0] ?? '')
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
      <div className="central-grupo" role="group" aria-label="Vista">
        <button
          type="button"
          className="central-botao"
          aria-label="Vista 3D"
          title="Volta ao 3D (perspectiva) e restaura os cortes"
          aria-pressed={vista.tipo === '3d'}
          disabled={!ativo}
          onClick={onVista3d}
        >
          3D
        </button>
        <select
          aria-label="Pavimento"
          value={pavimento}
          disabled={!ativo || pavimentos.length === 0}
          onChange={(e) => {
            setEscolhido(e.target.value)
            if (vista.tipo === 'planta') onPlanta(e.target.value)
          }}
        >
          {pavimentos.length === 0 && <option value="">Sem pavimentos</option>}
          {pavimentos.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="central-botao"
          aria-label="Planta"
          title="Planta do pavimento escolhido"
          aria-pressed={vista.tipo === 'planta'}
          disabled={!ativo || !pavimento}
          onClick={() => onPlanta(pavimento)}
        >
          Planta
        </button>
        {LADOS.map((l) => (
          <button
            key={l}
            type="button"
            className="central-botao"
            aria-label={`Elevação ${l}`}
            title={`Elevação ${NOMES_LADO[l]}`}
            aria-pressed={vista.tipo === 'elevacao' && vista.lado === l}
            disabled={!ativo}
            onClick={() => onElevacao(l)}
          >
            {l}
          </button>
        ))}
        <button
          type="button"
          className="central-botao"
          aria-label="Cortar"
          title={cortes > 0 ? `Novo plano de corte (${cortes} ativos)` : 'Novo plano de corte'}
          disabled={!ativo}
          onClick={onCortar}
        >
          Cortar
        </button>
        <button
          type="button"
          className="central-botao"
          aria-label="Minimapa"
          title="Minimapa com a posição da câmera"
          aria-pressed={minimapa}
          disabled={!ativo}
          onClick={onMinimapa}
        >
          Minimapa
        </button>
      </div>
      {BOTOES_FUTUROS.map((nome) => (
        <button key={nome} type="button" className="central-botao" aria-label={nome} aria-pressed="false" disabled>
          {nome}
        </button>
      ))}
    </div>
  )
}
