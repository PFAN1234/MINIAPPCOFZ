import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconeAngulo,
  IconeArea,
  IconeCaptura,
  IconeCor,
  IconeCortar,
  IconeDistancia,
  IconeEnquadrar,
  IconeGrade,
  IconeIssues,
  IconeMedir,
  IconeMinimapa,
  IconeModelos,
  IconeObra,
  IconePlanta,
  IconeProjecao,
  IconeVista3d,
  IconeVolume,
} from '../icones.tsx'
import { NOMES_MEDIDA, type ModoCor, type TipoMedida, type Vista3dUi } from '../../../../domain/central.ts'

/** Botões ainda desabilitados (ganham função nas próximas etapas). */
const BOTOES_FUTUROS: { nome: string; icone: ReactNode }[] = [
  { nome: 'Modelos', icone: <IconeModelos /> },
  { nome: 'Issues', icone: <IconeIssues /> },
  { nome: 'Captura', icone: <IconeCaptura /> },
  { nome: 'Obra', icone: <IconeObra /> },
]

const ICONES_MEDIDA: Record<TipoMedida, ReactNode> = {
  distancia: <IconeDistancia />,
  area: <IconeArea />,
  volume: <IconeVolume />,
  angulo: <IconeAngulo />,
}

/** Fecha o menu aberto com Esc ou clique fora do contêiner. */
function useFecharMenu(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const aoClicar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar()
    }
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
    }
    document.addEventListener('mousedown', aoClicar)
    document.addEventListener('keydown', aoTecla)
    return () => {
      document.removeEventListener('mousedown', aoClicar)
      document.removeEventListener('keydown', aoTecla)
    }
  }, [aberto, fechar])
  return ref
}

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
  /** Modo de medição ativo (null: nenhum). */
  medicao: TipoMedida | null
  onMedir(modo: TipoMedida | null): void
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
  medicao,
  onMedir,
}: Props) {
  const [menuMedir, setMenuMedir] = useState(false)
  const [menu, setMenu] = useState(false)
  const [escolhido, setEscolhido] = useState('')
  const refCor = useFecharMenu(menu, () => setMenu(false))
  // Com um modo de medição ativo o submenu fica aberto (paleta): os cliques no canvas não o fecham.
  const refMedir = useFecharMenu(menuMedir && medicao === null, () => setMenuMedir(false))
  const pavimento = pavimentos.includes(escolhido) ? escolhido : (pavimentos[0] ?? '')
  return (
    <div className="central-barra central-barra-superior" role="toolbar" aria-label="Ferramentas do visualizador">
      <div className="central-barra-grupo">
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Enquadrar"
          data-dica="Enquadrar (F)"
          disabled={!ativo}
          onClick={onEnquadrar}
        >
          <IconeEnquadrar />
        </button>
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Projeção"
          data-dica={ortografica ? 'Projeção ortográfica' : 'Projeção em perspectiva'}
          aria-pressed={ortografica}
          disabled={!ativo}
          onClick={onProjecao}
        >
          <IconeProjecao />
        </button>
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Grade"
          data-dica="Mostrar ou ocultar a grade"
          aria-pressed={grade}
          disabled={!ativo}
          onClick={onGrade}
        >
          <IconeGrade />
        </button>
        <div className="central-menu" ref={refCor}>
          <button
            type="button"
            className="central-botao central-botao-icone"
            aria-label="Cor"
            data-dica="Colorir por"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-pressed={cor !== 'nenhum'}
            disabled={!ativo}
            onClick={() => setMenu((m) => !m)}
          >
            <IconeCor />
          </button>
          {menu && (
            <div role="menu" aria-label="Colorir por" className="central-menu-lista">
              {MODOS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={cor === m.id}
                  className="central-botao central-botao-texto"
                  onClick={() => {
                    onCor(m.id)
                    setMenu(false)
                  }}
                >
                  <IconeCor />
                  {m.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="central-barra-grupo" role="group" aria-label="Vista">
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Vista 3D"
          data-dica="Volta ao 3D (perspectiva) e restaura os cortes"
          aria-pressed={vista.tipo === '3d'}
          disabled={!ativo}
          onClick={onVista3d}
        >
          <IconeVista3d />
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
          className="central-botao central-botao-icone"
          aria-label="Planta"
          data-dica="Planta do pavimento escolhido"
          aria-pressed={vista.tipo === 'planta'}
          disabled={!ativo || !pavimento}
          onClick={() => onPlanta(pavimento)}
        >
          <IconePlanta />
        </button>
        <span className="central-rotulo-grupo" aria-hidden="true">
          Elevação
        </span>
        {LADOS.map((l) => (
          <button
            key={l}
            type="button"
            className="central-botao central-botao-icone"
            aria-label={`Elevação ${l}`}
            data-dica={`Elevação ${NOMES_LADO[l]}`}
            aria-pressed={vista.tipo === 'elevacao' && vista.lado === l}
            disabled={!ativo}
            onClick={() => onElevacao(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="central-barra-grupo">
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Cortar"
          data-dica={cortes > 0 ? `Novo plano de corte (${cortes} ativos)` : 'Novo plano de corte'}
          disabled={!ativo}
          onClick={onCortar}
        >
          <IconeCortar />
        </button>
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Minimapa"
          data-dica="Minimapa com a posição da câmera"
          aria-pressed={minimapa}
          disabled={!ativo}
          onClick={onMinimapa}
        >
          <IconeMinimapa />
        </button>
        <div className="central-menu" ref={refMedir}>
          <button
            type="button"
            className="central-botao central-botao-icone"
            aria-label="Medir"
            data-dica="Medir distância, área, volume ou ângulo"
            aria-expanded={menuMedir}
            aria-pressed={medicao !== null}
            disabled={!ativo}
            onClick={() => setMenuMedir((m) => !m)}
          >
            <IconeMedir />
          </button>
          {menuMedir && (
            <div role="group" aria-label="Modo de medição" className="central-menu-lista">
              {(Object.keys(NOMES_MEDIDA) as TipoMedida[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="central-botao central-botao-texto"
                  aria-label={NOMES_MEDIDA[t]}
                  aria-pressed={medicao === t}
                  onClick={() => onMedir(medicao === t ? null : t)}
                >
                  {ICONES_MEDIDA[t]}
                  {NOMES_MEDIDA[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="central-barra-grupo central-barra-futuros">
        {BOTOES_FUTUROS.map(({ nome, icone }) => (
          <button
            key={nome}
            type="button"
            className="central-botao central-botao-icone"
            aria-label={nome}
            data-dica={nome}
            aria-pressed="false"
            disabled
          >
            {icone}
          </button>
        ))}
      </div>
    </div>
  )
}
