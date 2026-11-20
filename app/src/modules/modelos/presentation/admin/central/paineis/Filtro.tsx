import { useEffect, useRef, useState } from 'react'
import type { MotorVisualizador } from '../../../../application/ports/MotorVisualizador.port.ts'
import type { CategoriaTotal, FiltroAtributo, RefElemento } from '../../../../domain/central.ts'

const ATRIBUTOS = ['Name', 'ObjectType', 'Tag', 'PredefinedType']
const OUTRO = '__outro__'
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
}

/** Busca por atributo direto (classe, atributo, operador e valor). Psets ficam para uma etapa futura. */
export default function Filtro({ motor, versao, onSelecionar, onIsolar }: Props) {
  const [categorias, setCategorias] = useState<CategoriaTotal[]>([])
  const [classe, setClasse] = useState('')
  const [atributo, setAtributo] = useState('Name')
  const [livre, setLivre] = useState('')
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

  const nomeAtributo = atributo === OUTRO ? livre.trim() : atributo
  const precisaValor = operador !== 'existe'

  async function buscar() {
    if (!motor) return
    const n = ++pedido.current
    setEstado('buscando')
    const filtro: FiltroAtributo = {
      operador,
      ...(classe ? { classe } : {}),
      ...(nomeAtributo ? { atributo: nomeAtributo } : {}),
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
