import { useEffect, useState } from 'react'
import type { MotorVisualizador } from '../../../../application/ports/MotorVisualizador.port.ts'
import type { GrupoPropriedades, RefElemento } from '../../../../domain/central.ts'

interface Props {
  motor: MotorVisualizador | null
  selecao: RefElemento[]
}

type Lido = { chave: string; grupos: GrupoPropriedades[] | null; erro: boolean }

const chaveDe = (r: RefElemento) => `${r.sigla}:${r.globalId}`

/** Contagem por classe IFC da seleção, em ordem decrescente. */
function contarPorClasse(refs: RefElemento[]): [string, number][] {
  const mapa = new Map<string, number>()
  for (const r of refs) mapa.set(r.classe ?? 'Sem classe', (mapa.get(r.classe ?? 'Sem classe') ?? 0) + 1)
  return [...mapa].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Modo Inspecionar: propriedades do elemento selecionado, ou resumo da seleção múltipla. */
export default function Propriedades({ motor, selecao }: Props) {
  if (selecao.length === 0) return <p className="central-sec">Selecione um elemento para inspecionar.</p>
  if (selecao.length > 1) {
    return (
      <div className="central-selecao" aria-live="polite">
        <strong>{selecao.length} elementos selecionados</strong>
        <ul className="central-contagem" aria-label="Contagem por classe">
          {contarPorClasse(selecao).map(([classe, n]) => (
            <li key={classe}>
              {classe} <span className="central-sec">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return <Elemento motor={motor} refElemento={selecao[0]} />
}

function Elemento({ motor, refElemento }: { motor: MotorVisualizador | null; refElemento: RefElemento }) {
  const chave = chaveDe(refElemento)
  const [lido, setLido] = useState<Lido | null>(null)
  const [filtro, setFiltro] = useState('')
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!motor) return
    // Ao trocar a seleção, a resposta anterior é descartada (a chamada não aplica o resultado).
    let ativo = true
    motor.propriedades(refElemento).then(
      (grupos) => ativo && setLido({ chave, grupos, erro: false }),
      () => ativo && setLido({ chave, grupos: null, erro: true }),
    )
    return () => {
      ativo = false
    }
    // `refElemento` é identificado pela chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motor, chave])

  async function copiar() {
    try {
      await navigator.clipboard.writeText(refElemento.globalId)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      setCopiado(false)
    }
  }

  const atual = lido?.chave === chave ? lido : null
  const termo = filtro.trim().toLowerCase()
  const grupos = (atual?.grupos ?? [])
    .map((g) => ({
      ...g,
      itens: termo
        ? g.itens.filter((i) => i.nome.toLowerCase().includes(termo) || i.valor.toLowerCase().includes(termo))
        : g.itens,
    }))
    .filter((g) => g.itens.length > 0)
  const semQuantidades = atual?.grupos != null && !atual.grupos.some((g) => g.quantidades)

  return (
    <div className="central-propriedades">
      <strong>{refElemento.nome ?? refElemento.classe ?? 'Elemento'}</strong>
      <div className="central-propriedades-topo">
        <input
          type="search"
          aria-label="Filtrar propriedades"
          placeholder="Filtrar propriedades"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <button type="button" className="central-botao" onClick={() => void copiar()}>
          {copiado ? 'Copiado' : 'Copiar GlobalId'}
        </button>
      </div>
      {!atual && <p className="central-sec">Carregando propriedades…</p>}
      {atual?.erro && <p role="alert">Não foi possível ler as propriedades.</p>}
      {atual?.grupos && grupos.length === 0 && <p className="central-sec">Nenhuma propriedade encontrada.</p>}
      {grupos.map((g) => (
        <details key={g.nome} open={g.nome === 'Atributos' || termo !== ''} className="central-grupo">
          <summary>{g.nome}</summary>
          <dl>
            {g.itens.map((i, k) => (
              <div key={`${i.nome}-${k}`}>
                <dt>{i.nome}</dt>
                <dd className={i.nome === 'GlobalId' ? 'central-guid' : undefined}>{i.valor}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      {semQuantidades && <p className="central-sec">Sem quantidades no IFC</p>}
    </div>
  )
}
