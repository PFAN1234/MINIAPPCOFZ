/**
 * Etapa 2: recorte do edifício e máscaras sobre a página inteira. Arrastar no desenho cria um
 * retângulo (o recorte ou uma máscara nova, conforme a ferramenta); arrastar um retângulo o
 * move; as alças dos cantos redimensionam. Os valores ficam normalizados (0–1), como no
 * `obra.json`, e também podem ser digitados na tabela.
 */
import { useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from 'react'

/** O `<svg>` de um evento num elemento dele (ou nele mesmo). */
export function svgDoEvento(e: { currentTarget: Element }): SVGSVGElement {
  const el = e.currentTarget as SVGElement
  return (el instanceof SVGSVGElement ? el : el.ownerSVGElement) as SVGSVGElement
}
import type { PaginaAberta, ImagemGerada } from '../../planta/servico.ts'
import type { Prancha, Retangulo } from '../../planta/tipos.ts'
import { mensagemDe } from '../../componentes.tsx'

type Alvo = { tipo: 'recorte' } | { tipo: 'mascara'; indice: number }
type Ferramenta = 'recorte' | 'mascara'

interface Arrasto {
  modo: 'desenhar' | 'mover' | 'canto'
  alvo: Alvo
  inicio: [number, number]
  original: Retangulo
  canto?: number
}

const LARGURA_PREVIA = 1600

function normalizar(r: Retangulo): Retangulo {
  const lim = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000))
  return [lim(Math.min(r[0], r[2])), lim(Math.min(r[1], r[3])), lim(Math.max(r[0], r[2])), lim(Math.max(r[1], r[3]))]
}

export function pontoNormalizado(e: { clientX: number; clientY: number }, el: Element): [number, number] {
  const caixa = el.getBoundingClientRect()
  if (!caixa.width || !caixa.height) return [0, 0]
  return [(e.clientX - caixa.left) / caixa.width, (e.clientY - caixa.top) / caixa.height]
}

export function usePrevia(gerar: (() => Promise<ImagemGerada>) | null, chave: string) {
  const [imagem, setImagem] = useState<ImagemGerada | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const gerarRef = useRef(gerar)
  useEffect(() => {
    gerarRef.current = gerar
  })
  useEffect(() => {
    let ativo = true
    let url: string | null = null
    const g = gerarRef.current
    if (!g) return
    setImagem(null)
    setErro(null)
    g().then(
      (i) => {
        url = i.url
        if (ativo) setImagem(i)
        else if (i.url.startsWith('blob:')) URL.revokeObjectURL(i.url)
      },
      (e: unknown) => ativo && setErro(mensagemDe(e, 'Não foi possível desenhar a planta.')),
    )
    return () => {
      ativo = false
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [chave])
  return { imagem, erro }
}

export default function Recorte({
  pagina,
  prancha,
  paraTodos,
  onMudar,
  onParaTodos,
}: {
  pagina: PaginaAberta
  prancha: Prancha
  paraTodos: boolean
  onMudar: (p: Prancha) => void
  onParaTodos: (v: boolean) => void
}) {
  const { imagem, erro } = usePrevia(() => pagina.previa(LARGURA_PREVIA), `previa-${pagina.numero}`)
  const [ferramenta, setFerramenta] = useState<Ferramenta>('recorte')
  const [selecionado, setSelecionado] = useState<Alvo | null>(null)
  const [arrasto, setArrasto] = useState<Arrasto | null>(null)
  const W = pagina.largura
  const H = pagina.altura
  const mascaras = prancha.mascaras ?? []

  const retanguloDe = (a: Alvo): Retangulo =>
    a.tipo === 'recorte' ? prancha.recorte_edificio : mascaras[a.indice].retangulo
  function gravar(a: Alvo, r: Retangulo) {
    const n = normalizar(r)
    if (a.tipo === 'recorte') onMudar({ ...prancha, recorte_edificio: n })
    else onMudar({ ...prancha, mascaras: mascaras.map((m, i) => (i === a.indice ? { ...m, retangulo: n } : m)) })
  }

  function iniciar(e: EventoPonteiro<SVGElement>, modo: Arrasto['modo'], alvo: Alvo | null, canto?: number) {
    const svg = svgDoEvento(e)
    if (!svg) return
    e.stopPropagation()
    e.preventDefault()
    svg.setPointerCapture?.(e.pointerId)
    const p = pontoNormalizado(e, svg)
    if (modo === 'desenhar') {
      const novo: Retangulo = [p[0], p[1], p[0], p[1]]
      let a: Alvo
      // `original` guarda o recorte anterior: um clique sem arrastar não o apaga.
      const anterior = prancha.recorte_edificio
      if (ferramenta === 'recorte') {
        a = { tipo: 'recorte' }
        onMudar({ ...prancha, recorte_edificio: novo })
      } else {
        a = { tipo: 'mascara', indice: mascaras.length }
        onMudar({ ...prancha, mascaras: [...mascaras, { retangulo: novo, descricao: '' }] })
      }
      setSelecionado(a)
      setArrasto({ modo, alvo: a, inicio: p, original: anterior })
      return
    }
    setSelecionado(alvo)
    setArrasto({ modo, alvo: alvo!, inicio: p, original: retanguloDe(alvo!), canto })
  }

  function mover(e: EventoPonteiro<SVGSVGElement>) {
    if (!arrasto) return
    const p = pontoNormalizado(e, e.currentTarget)
    const [x0, y0, x1, y1] = arrasto.original
    if (arrasto.modo === 'desenhar') {
      gravar(arrasto.alvo, [arrasto.inicio[0], arrasto.inicio[1], p[0], p[1]])
    } else if (arrasto.modo === 'mover') {
      const dx = Math.min(Math.max(p[0] - arrasto.inicio[0], -x0), 1 - x1)
      const dy = Math.min(Math.max(p[1] - arrasto.inicio[1], -y0), 1 - y1)
      gravar(arrasto.alvo, [x0 + dx, y0 + dy, x1 + dx, y1 + dy])
    } else {
      const c = arrasto.canto ?? 0
      gravar(arrasto.alvo, [c === 0 || c === 3 ? p[0] : x0, c < 2 ? p[1] : y0, c === 1 || c === 2 ? p[0] : x1, c >= 2 ? p[1] : y1])
    }
  }

  function soltar() {
    const minusculo = (r: Retangulo | undefined) => !!r && (r[2] - r[0] < 0.003 || r[3] - r[1] < 0.003)
    if (arrasto?.modo === 'desenhar' && arrasto.alvo.tipo === 'recorte' && minusculo(prancha.recorte_edificio)) {
      onMudar({ ...prancha, recorte_edificio: arrasto.original })
    }
    if (arrasto?.modo === 'desenhar' && arrasto.alvo.tipo === 'mascara') {
      const indice = arrasto.alvo.indice
      const r = mascaras[indice]?.retangulo
      // Clique sem arrastar: não cria máscara vazia.
      if (r && (r[2] - r[0] < 0.003 || r[3] - r[1] < 0.003)) {
        onMudar({ ...prancha, mascaras: mascaras.filter((_, i) => i !== indice) })
        setSelecionado(null)
      }
    }
    setArrasto(null)
  }

  function campo(alvo: Alvo, k: number, valor: string) {
    const v = Number(valor.replace(',', '.'))
    if (!Number.isFinite(v)) return
    const r = [...retanguloDe(alvo)] as Retangulo
    r[k] = v
    if (alvo.tipo === 'recorte') onMudar({ ...prancha, recorte_edificio: r })
    else onMudar({ ...prancha, mascaras: mascaras.map((m, i) => (i === alvo.indice ? { ...m, retangulo: r } : m)) })
  }

  const ehSel = (a: Alvo) =>
    selecionado?.tipo === a.tipo && (a.tipo === 'recorte' || (selecionado as { indice: number }).indice === a.indice)

  function desenharRet(alvo: Alvo, r: Retangulo, classe: string) {
    const [x0, y0, x1, y1] = [r[0] * W, r[1] * H, r[2] * W, r[3] * H]
    const sel = ehSel(alvo)
    const alca = Math.max(W, H) / 160
    return (
      <g key={alvo.tipo === 'recorte' ? 'recorte' : `m${alvo.indice}`}>
        <rect
          className={`${classe}${sel ? ' adm-ret-sel' : ''}`}
          x={x0}
          y={y0}
          width={Math.max(0, x1 - x0)}
          height={Math.max(0, y1 - y0)}
          onPointerDown={(e) => iniciar(e, 'mover', alvo)}
          data-testid={alvo.tipo === 'recorte' ? 'ret-recorte' : `ret-mascara-${alvo.indice}`}
        />
        {sel &&
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ].map(([cx, cy], i) => (
            <rect
              key={i}
              className="adm-alca"
              x={cx - alca / 2}
              y={cy - alca / 2}
              width={alca}
              height={alca}
              onPointerDown={(e) => iniciar(e, 'canto', alvo, i)}
            />
          ))}
      </g>
    )
  }

  return (
    <section aria-labelledby="titulo-recorte">
      <h2 id="titulo-recorte">Recorte e máscaras</h2>
      <p className="adm-dica">
        Desenhe o retângulo do edifício (o que aparece no app) e cubra de branco legendas, quadros e carimbo que caem dentro
        dele. Arraste no desenho para criar; arraste um retângulo para mover; use os cantos para redimensionar.
      </p>
      <div className="adm-acoes" role="radiogroup" aria-label="Ferramenta">
        <label className="adm-opcao">
          <input type="radio" name="ferramenta" checked={ferramenta === 'recorte'} onChange={() => setFerramenta('recorte')} />
          Desenhar o recorte do edifício
        </label>
        <label className="adm-opcao">
          <input type="radio" name="ferramenta" checked={ferramenta === 'mascara'} onChange={() => setFerramenta('mascara')} />
          Desenhar uma máscara
        </label>
      </div>
      {erro && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="adm-prancha">
        {imagem ? (
          <img src={imagem.url} alt={`Página ${pagina.numero} do PDF`} draggable={false} />
        ) : (
          !erro && <p className="adm-estado">Desenhando a página…</p>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="adm-sobreposicao"
          aria-label="Recorte e máscaras sobre a página"
          onPointerDown={(e) => iniciar(e, 'desenhar', null)}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        >
          {desenharRet({ tipo: 'recorte' }, prancha.recorte_edificio, 'adm-ret-recorte')}
          {mascaras.map((m, i) => desenharRet({ tipo: 'mascara', indice: i }, m.retangulo, 'adm-ret-mascara'))}
        </svg>
      </div>

      <table className="adm-tabela adm-tabela-compacta">
        <thead>
          <tr>
            <th scope="col">Retângulo</th>
            <th scope="col">x0</th>
            <th scope="col">y0</th>
            <th scope="col">x1</th>
            <th scope="col">y1</th>
            <th scope="col">Descrição</th>
            <th scope="col">
              <span className="adm-oculto">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[{ tipo: 'recorte' } as Alvo, ...mascaras.map((_, i) => ({ tipo: 'mascara', indice: i }) as Alvo)].map((alvo) => {
            const r = retanguloDe(alvo)
            const nome = alvo.tipo === 'recorte' ? 'Recorte do edifício' : `Máscara ${alvo.indice + 1}`
            return (
              <tr key={nome} className={ehSel(alvo) ? 'adm-linha-sel' : undefined} onClick={() => setSelecionado(alvo)}>
                <th scope="row">{nome}</th>
                {r.map((v, k) => (
                  <td key={k}>
                    <input
                      aria-label={`${nome} ${['x0', 'y0', 'x1', 'y1'][k]}`}
                      className="adm-input-curto"
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={v}
                      onChange={(e) => campo(alvo, k, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  {alvo.tipo === 'mascara' && (
                    <input
                      aria-label={`Descrição da ${nome.toLowerCase()}`}
                      value={mascaras[alvo.indice].descricao ?? ''}
                      onChange={(e) =>
                        onMudar({
                          ...prancha,
                          mascaras: mascaras.map((m, i) => (i === alvo.indice ? { ...m, descricao: e.target.value } : m)),
                        })
                      }
                    />
                  )}
                </td>
                <td>
                  {alvo.tipo === 'mascara' && (
                    <button
                      type="button"
                      className="adm-botao adm-botao-discreto"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelecionado(null)
                        onMudar({ ...prancha, mascaras: mascaras.filter((_, i) => i !== alvo.indice) })
                      }}
                    >
                      Apagar {nome.toLowerCase()}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="adm-acoes">
        <button
          type="button"
          className="adm-botao"
          onClick={() => {
            setSelecionado({ tipo: 'mascara', indice: mascaras.length })
            onMudar({ ...prancha, mascaras: [...mascaras, { retangulo: [0.8, 0.8, 0.95, 0.95], descricao: '' }] })
          }}
        >
          Incluir máscara
        </button>
        <label className="adm-opcao">
          <input type="checkbox" checked={paraTodos} onChange={(e) => onParaTodos(e.target.checked)} />
          Usar este recorte e estas máscaras em todos os pavimentos da obra
        </label>
      </div>
    </section>
  )
}
