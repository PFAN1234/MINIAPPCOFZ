import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Carregando, Erro } from '../../../../../admin/componentes.tsx'
import BarraSuperior from './barras/BarraSuperior.tsx'
import BarraVisibilidade from './barras/BarraVisibilidade.tsx'
import { useObrasCentral } from './CentralModelos.tsx'
import { gravarTema, lerTema, type Tema } from './tema.ts'
import './central.css'

const PAINEIS = [
  { id: 'itens', nome: 'Itens', etapa: 2 },
  { id: 'documentos', nome: 'Documentos', etapa: 6 },
  { id: 'issues', nome: 'Issues', etapa: 7 },
  { id: 'medicoes', nome: 'Medições', etapa: 4 },
  { id: 'gestao', nome: 'Gestão', etapa: 5 },
] as const

const LARGURA_MIN = 240
const LARGURA_MAX = 520
const limitar = (n: number) => Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, n))

/** Visualizador de uma obra: casca com trilho, painéis, canvas (placeholder) e barras. */
export default function CentralObra() {
  const { slug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const obras = useObrasCentral()
  const [tema, setTema] = useState<Tema>(lerTema)
  const [aberto, setAberto] = useState(true)
  const [largura, setLargura] = useState(320)
  const arrasto = useRef<{ x: number; largura: number } | null>(null)

  const pedido = params.get('painel')
  const painel = PAINEIS.find((p) => p.id === pedido) ?? PAINEIS[0]

  if (obras.isPending) return <Carregando texto="Carregando a obra…" />
  if (obras.isError) return <Erro erro={obras.error} onTentar={() => void obras.refetch()} />
  const obra = obras.data.find((o) => o.slug === slug)
  if (!obra) {
    return (
      <section className="central-lista">
        <p>Obra não encontrada.</p>
        <Link to="/modelos">Todas as obras</Link>
      </section>
    )
  }

  function escolher(id: string) {
    const novo = new URLSearchParams(params)
    novo.set('painel', id)
    setParams(novo, { replace: true })
    setAberto(true)
  }
  function alternarTema() {
    const novo: Tema = tema === 'escuro' ? 'claro' : 'escuro'
    setTema(novo)
    gravarTema(novo)
  }
  function iniciarArrasto(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    arrasto.current = { x: e.clientX, largura }
  }
  function arrastar(e: PointerEvent<HTMLDivElement>) {
    if (arrasto.current) setLargura(limitar(arrasto.current.largura + e.clientX - arrasto.current.x))
  }
  function teclaBorda(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') setLargura((l) => limitar(l - 16))
    if (e.key === 'ArrowRight') setLargura((l) => limitar(l + 16))
  }
  const ordem: string[] = PAINEIS.map((p) => p.id)
  function teclaAba(e: KeyboardEvent<HTMLButtonElement>) {
    const i = ordem.indexOf(painel.id)
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (d) {
      e.preventDefault()
      escolher(ordem[(i + d + ordem.length) % ordem.length])
    }
  }

  return (
    <div className="central" data-tema={tema} data-painel-aberto={aberto}>
      <nav className="central-trilho" aria-label="Painéis da central">
        <div role="tablist" aria-orientation="vertical" className="central-abas">
          {PAINEIS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`aba-${p.id}`}
              aria-selected={p.id === painel.id}
              aria-controls="painel-central"
              tabIndex={p.id === painel.id ? 0 : -1}
              className="central-aba"
              onClick={() => escolher(p.id)}
              onKeyDown={teclaAba}
            >
              {p.nome}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="central-botao"
          aria-label={`Configurações: mudar para o tema ${tema === 'escuro' ? 'claro' : 'escuro'}`}
          title="Configurações"
          onClick={alternarTema}
        >
          ⚙ {tema === 'escuro' ? 'Escuro' : 'Claro'}
        </button>
      </nav>

      {aberto && (
        <aside className="central-lateral" style={{ width: largura }}>
          <section id="painel-central" role="tabpanel" aria-labelledby={`aba-${painel.id}`} className="central-painel">
            <h2>{painel.nome}</h2>
            <p className="central-sec">Disponível na etapa {painel.etapa}</p>
          </section>
          <section className="central-contexto" aria-label="Contexto">
            <h3>{obra.nome}</h3>
            <Link to="/modelos">Todas as obras</Link>
            <p className="central-sec">Nenhuma seleção.</p>
          </section>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar painel"
            aria-valuemin={LARGURA_MIN}
            aria-valuemax={LARGURA_MAX}
            aria-valuenow={largura}
            tabIndex={0}
            className="central-borda"
            onPointerDown={iniciarArrasto}
            onPointerMove={arrastar}
            onPointerUp={() => (arrasto.current = null)}
            onKeyDown={teclaBorda}
          />
        </aside>
      )}

      <div className="central-direita">
        <button
          type="button"
          className="central-botao central-recolher"
          aria-label={aberto ? 'Recolher painel' : 'Abrir painel'}
          aria-expanded={aberto}
          onClick={() => setAberto((a) => !a)}
        >
          {aberto ? '«' : '»'}
        </button>
        <BarraSuperior />
        <div className="central-canvas" data-testid="canvas-central">
          <div className="central-modo" role="group" aria-label="Modo">
            <button type="button" className="central-botao" aria-label="Ver" aria-pressed="true" disabled>
              Ver
            </button>
            <button type="button" className="central-botao" aria-label="Inspecionar" aria-pressed="false" disabled>
              Inspecionar
            </button>
          </div>
          <BarraVisibilidade />
        </div>
      </div>
    </div>
  )
}
