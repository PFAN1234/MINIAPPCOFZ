import { useEffect, useState } from 'react'
import type { MotorVisualizador } from '../../../../application/ports/MotorVisualizador.port.ts'
import { filhosVisiveis, type CategoriaTotal, type NoArvore, type RefElemento } from '../../../../domain/central.ts'
import type { ModeloFrag } from '../../../../domain/modelos.ts'

type SubAba = 'arvore' | 'categorias' | 'modelos'

const SUBABAS: { id: SubAba; nome: string }[] = [
  { id: 'arvore', nome: 'Árvore' },
  { id: 'categorias', nome: 'Categorias' },
  { id: 'modelos', nome: 'Modelos' },
]

interface Props {
  motor: MotorVisualizador | null
  /** Muda a cada carga/descarga de modelo: refaz a árvore e as categorias. */
  versao: number
  modelos: ModeloFrag[]
  ativos: string[]
  falhas: string[]
  selecionados: RefElemento[]
  onSelecionar(refs: RefElemento[]): void
  onAlternarModelo(sigla: string, ligado: boolean): void
}

/** Painel Itens da central: árvore espacial, categorias IFC e disciplinas carregadas. */
export default function Itens({ motor, versao, modelos, ativos, falhas, selecionados, onSelecionar, onAlternarModelo }: Props) {
  const [aba, setAba] = useState<SubAba>('arvore')
  return (
    <div className="central-itens">
      <div role="tablist" aria-label="Itens" className="central-subabas">
        {SUBABAS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={aba === s.id}
            className="central-botao"
            onClick={() => setAba(s.id)}
          >
            {s.nome}
          </button>
        ))}
      </div>
      {aba === 'arvore' && <Arvore motor={motor} versao={versao} selecionados={selecionados} onSelecionar={onSelecionar} />}
      {aba === 'categorias' && <Categorias motor={motor} versao={versao} />}
      {aba === 'modelos' && (
        <Modelos modelos={modelos} ativos={ativos} falhas={falhas} onAlternar={onAlternarModelo} />
      )}
    </div>
  )
}

/** Lê dados assíncronos do motor e refaz a leitura quando `versao` muda. */
function useDoMotor<T>(motor: MotorVisualizador | null, versao: number, ler: (m: MotorVisualizador) => Promise<T>) {
  const [lido, setLido] = useState<{ motor: MotorVisualizador; versao: number; dados: T | null; erro: boolean } | null>(null)
  useEffect(() => {
    if (!motor) return
    let ativo = true
    ler(motor).then(
      (dados) => ativo && setLido({ motor, versao, dados, erro: false }),
      () => ativo && setLido({ motor, versao, dados: null, erro: true }),
    )
    return () => {
      ativo = false
    }
    // `ler` é estável por chamada: a leitura só depende do motor e da versão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motor, versao])
  const atual = lido !== null && lido.motor === motor && lido.versao === versao
  return { dados: atual ? lido.dados : null, erro: atual && lido.erro, carregando: !atual }
}

function Arvore({
  motor,
  versao,
  selecionados,
  onSelecionar,
}: {
  motor: MotorVisualizador | null
  versao: number
  selecionados: RefElemento[]
  onSelecionar(refs: RefElemento[]): void
}) {
  const { dados, erro, carregando } = useDoMotor(motor, versao, (m) => m.arvore())
  if (!motor || carregando) return <p className="central-sec">Carregando a árvore…</p>
  if (erro) return <p role="alert">Não foi possível ler a estrutura do modelo.</p>
  if (!dados || dados.length === 0) return <p className="central-sec">Nenhum modelo carregado.</p>
  const marcados = new Set(selecionados.map((r) => `${r.sigla}:${r.globalId}`))
  return (
    <ul className="central-arvore" role="tree" aria-label="Árvore do modelo">
      {dados.map((no) => (
        <NoLinha key={no.id} no={no} nivel={0} marcados={marcados} onSelecionar={onSelecionar} />
      ))}
    </ul>
  )
}

function NoLinha({
  no,
  nivel,
  marcados,
  onSelecionar,
}: {
  no: NoArvore
  nivel: number
  marcados: ReadonlySet<string>
  onSelecionar(refs: RefElemento[]): void
}) {
  const [aberto, setAberto] = useState(nivel === 0)
  const [paginas, setPaginas] = useState(1)
  const temFilhos = no.filhos.length > 0
  const marcado = no.ref ? marcados.has(`${no.ref.sigla}:${no.ref.globalId}`) : false
  const { itens, restantes } = filhosVisiveis(no.filhos, paginas)
  return (
    <li role="treeitem" aria-expanded={temFilhos ? aberto : undefined} aria-selected={marcado}>
      <div className="central-no" style={{ paddingLeft: nivel * 12 }}>
        {temFilhos ? (
          <button
            type="button"
            className="central-botao central-no-seta"
            aria-label={`${aberto ? 'Recolher' : 'Expandir'} ${no.rotulo}`}
            onClick={() => setAberto((a) => !a)}
          >
            {aberto ? '▾' : '▸'}
          </button>
        ) : (
          <span className="central-no-seta" aria-hidden="true" />
        )}
        {no.ref ? (
          <button
            type="button"
            className="central-no-nome"
            data-selecionado={marcado}
            onClick={() => onSelecionar([no.ref!])}
          >
            {no.rotulo}
          </button>
        ) : (
          <span className="central-no-nome">{no.rotulo}</span>
        )}
        {temFilhos && <span className="central-sec">{no.filhos.length}</span>}
      </div>
      {temFilhos && aberto && (
        <ul role="group">
          {itens.map((f) => (
            <NoLinha key={f.id} no={f} nivel={nivel + 1} marcados={marcados} onSelecionar={onSelecionar} />
          ))}
          {restantes > 0 && (
            <li>
              <button type="button" className="central-botao" onClick={() => setPaginas((p) => p + 1)}>
                Mostrar mais ({restantes})
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function Categorias({ motor, versao }: { motor: MotorVisualizador | null; versao: number }) {
  const { dados, erro, carregando } = useDoMotor<CategoriaTotal[]>(motor, versao, (m) => m.categorias())
  if (!motor || carregando) return <p className="central-sec">Carregando as categorias…</p>
  if (erro) return <p role="alert">Não foi possível ler as categorias.</p>
  if (!dados || dados.length === 0) return <p className="central-sec">Nenhum modelo carregado.</p>
  return (
    <ul className="central-categorias" aria-label="Categorias IFC">
      {dados.map((c) => (
        <li key={c.classe}>
          <span>{c.classe}</span>
          <span className="central-sec">{c.total}</span>
        </li>
      ))}
    </ul>
  )
}

function Modelos({
  modelos,
  ativos,
  falhas,
  onAlternar,
}: {
  modelos: ModeloFrag[]
  ativos: string[]
  falhas: string[]
  onAlternar(sigla: string, ligado: boolean): void
}) {
  if (modelos.length === 0) return <p className="central-sec">Sem modelos publicados.</p>
  return (
    <ul className="central-modelos" aria-label="Modelos da obra">
      {modelos.map((m) => (
        <li key={m.sigla}>
          <label>
            <input
              type="checkbox"
              checked={ativos.includes(m.sigla)}
              onChange={(e) => onAlternar(m.sigla, e.target.checked)}
            />{' '}
            {m.sigla}
            {m.revisao ? ` (${m.revisao})` : ''}
          </label>
          {falhas.includes(m.sigla) && <span className="central-sec"> não carregou</span>}
        </li>
      ))}
    </ul>
  )
}
