import { useEffect, useRef, useState } from 'react'
import type { MotorVisualizador } from '../../../../application/ports/MotorVisualizador.port.ts'
import type { CategoriaTotal, FiltroAtributo, GrupoPropriedades, RefElemento } from '../../../../domain/central.ts'

const ATRIBUTOS = ['Name', 'ObjectType', 'Tag', 'PredefinedType']
const OUTRO = '__outro__'
type Origem = 'atributo' | 'pset'
const OPERADORES: { id: FiltroAtributo['operador']; nome: string }[] = [
  { id: 'contem', nome: 'contém' },
  { id: 'igual', nome: 'é igual a' },
  { id: 'diferente', nome: 'é diferente de' },
  { id: 'existe', nome: 'existe' },
]

type Estado = { refs: RefElemento[] } | 'buscando' | 'erro' | null

interface Props {
  motor: MotorVisualizador | null
  /** Muda a cada carga/descarga de modelo: refaz a lista de classes. */
  versao: number
  onSelecionar(refs: RefElemento[]): void
  /** Isola pelo mesmo caminho da barra de visibilidade (mantém o estado "isolado" da barra). */
  onIsolar(refs: RefElemento[]): void
  /** Elemento selecionado: dá sugestões de pset/propriedade (opcional). */
  selecionado?: RefElemento | null
}

/** Busca por atributo direto ou por propriedade de pset (classe, origem, nome, operador e valor). */
export default function Filtro({ motor, versao, onSelecionar, onIsolar, selecionado }: Props) {
  const [categorias, setCategorias] = useState<CategoriaTotal[]>([])
  const [classe, setClasse] = useState('')
  const [atributo, setAtributo] = useState('Name')
  const [livre, setLivre] = useState('')
  const [origem, setOrigem] = useState<Origem>('atributo')
  const [pset, setPset] = useState('')
  const [propriedade, setPropriedade] = useState('')
  const [sugestoes, setSugestoes] = useState<GrupoPropriedades[]>([])
  const [operador, setOperador] = useState<FiltroAtributo['operador']>('contem')
  const [valor, setValor] = useState('')
  const [estado, setEstado] = useState<Estado>(null)
  const pedido = useRef(0)

  useEffect(() => {
    if (!motor) return
    let ativo = true
    motor.categorias().then(
      (c) => ativo && setCategorias(c),
      () => ativo && setCategorias([]),
    )
    return () => {
      ativo = false
    }
  }, [motor, versao])

  // Sugestões de pset/propriedade vêm do elemento selecionado, quando houver.
  useEffect(() => {
    if (!motor || !selecionado || origem !== 'pset') return
    let ativo = true
    motor.propriedades(selecionado).then(
      (g) => ativo && setSugestoes(g.filter((x) => x.nome !== 'Atributos')),
      () => ativo && setSugestoes([]),
    )
    return () => {
      ativo = false
    }
  }, [motor, selecionado, origem])

  const nomeAtributo = atributo === OUTRO ? livre.trim() : atributo
  const precisaValor = operador !== 'existe'

  async function buscar() {
    if (!motor) return
    if (origem === 'pset' && !pset.trim()) return
    const n = ++pedido.current
    setEstado('buscando')
    const filtro: FiltroAtributo = {
      operador,
      ...(classe ? { classe } : {}),
      ...(origem === 'pset'
        ? {
            grupo: pset.trim(),
            ...(propriedade.trim() ? { atributo: propriedade.trim() } : {}),
          }
        : nomeAtributo
          ? { atributo: nomeAtributo }
          : {}),
      ...(precisaValor && valor.trim() ? { valor: valor.trim() } : {}),
    }
    try {
      const refs = await motor.buscar(filtro)
      if (n === pedido.current) setEstado({ refs })
    } catch {
      if (n === pedido.current) setEstado('erro')
    }
  }
  const refs = typeof estado === 'object' && estado !== null ? estado.refs : null
  return (
    <form
      className="central-filtro"
      aria-label="Busca por atributo"
      onSubmit={(e) => {
        e.preventDefault()
        void buscar()
      }}
    >
      <label>
        Classe
        <select value={classe} onChange={(e) => setClasse(e.target.value)}>
          <option value="">Todas</option>
          {categorias.map((c) => (
            <option key={c.classe} value={c.classe}>
              {c.classe} ({c.total})
            </option>
          ))}
        </select>
      </label>
      <label>
        Origem
        <select value={origem} onChange={(e) => setOrigem(e.target.value as Origem)}>
          <option value="atributo">Atributo</option>
          <option value="pset">Propriedade (pset)</option>
        </select>
      </label>
      {origem === 'pset' ? (
        <>
          <label>
            Pset
            <input
              value={pset}
              onChange={(e) => setPset(e.target.value)}
              list="filtro-psets"
              placeholder="Pset_WallCommon"
            />
          </label>
          <label>
            Propriedade
            <input
              value={propriedade}
              onChange={(e) => setPropriedade(e.target.value)}
              list="filtro-props"
              placeholder="IsExternal"
            />
          </label>
          <datalist id="filtro-psets">
            {sugestoes.map((g) => (
              <option key={g.nome} value={g.nome} />
            ))}
          </datalist>
          <datalist id="filtro-props">
            {(sugestoes.find((g) => g.nome === pset.trim())?.itens ?? []).map((i) => (
              <option key={i.nome} value={i.nome} />
            ))}
          </datalist>
        </>
      ) : (
        <>
          <label>
            Atributo
            <select value={atributo} onChange={(e) => setAtributo(e.target.value)}>
              {ATRIBUTOS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              <option value={OUTRO}>Outro…</option>
            </select>
          </label>
          {atributo === OUTRO && (
            <label>
              Nome do atributo
              <input value={livre} onChange={(e) => setLivre(e.target.value)} />
            </label>
          )}
        </>
      )}
      <label>
        Operador
        <select value={operador} onChange={(e) => setOperador(e.target.value as FiltroAtributo['operador'])}>
          {OPERADORES.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
      </label>
      {precisaValor && (
        <label>
          Valor
          <input value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
      )}
      <button type="submit" className="central-botao" disabled={!motor || estado === 'buscando'}>
        Buscar
      </button>
      {estado === 'buscando' && <p className="central-sec">Buscando…</p>}
      {estado === 'erro' && <p role="alert">Não foi possível buscar.</p>}
      {refs && (
        <>
          <p className="central-sec" role="status">
            {refs.length} {refs.length === 1 ? 'resultado' : 'resultados'}
          </p>
          {refs.length > 0 && (
            <div className="central-filtro-acoes">
              <button type="button" className="central-botao" onClick={() => onSelecionar(refs)}>
                Selecionar
              </button>
              <button type="button" className="central-botao" onClick={() => onIsolar(refs)}>
                Isolar resultados
              </button>
              <button type="button" className="central-botao" onClick={() => motor?.enquadrar(refs)}>
                Enquadrar
              </button>
            </div>
          )}
        </>
      )}
    </form>
  )
}
