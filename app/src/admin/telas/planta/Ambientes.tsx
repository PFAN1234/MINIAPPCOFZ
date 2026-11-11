/**
 * Etapa 3: ambientes extraídos, em tabela e sobre a planta recortada. Renomear, mudar a
 * categoria, arrastar pinos, remover pino extra, incluir ambiente sem rótulo clicando na
 * planta. Os casos de "revisar" do extrator ficam destacados.
 */
import { useMemo, useState, type PointerEvent as EventoPonteiro } from 'react'
import { SelectCategoria } from '../../componentes.tsx'
import { ehManual } from '../../planta/editor.ts'
import type { ImagemCalculada } from '../../planta/plantas.ts'
import type { PaginaAberta } from '../../planta/servico.ts'
import type { Ambiente, ItemRevisar, Retangulo } from '../../planta/tipos.ts'
import { pontoNormalizado, svgDoEvento, usePrevia } from './Recorte.tsx'

export interface AcoesAmbientes {
  renomear(a: Ambiente, nome: string): void
  categoria(a: Ambiente, cat: string): void
  moverPino(a: Ambiente, indice: number, x: number, y: number): void
  removerPino(a: Ambiente, indice: number): void
  restaurarPinos(a: Ambiente): void
  incluir(nome: string, cat: string, x: number, y: number): void
  removerManual(a: Ambiente): void
}

function NomeEditavel({ a, onRenomear }: { a: Ambiente; onRenomear: (nome: string) => void }) {
  const [texto, setTexto] = useState(a.nome_operacional)
  const confirmar = () => {
    if (texto.trim() && texto.trim() !== a.nome_operacional) onRenomear(texto)
    else setTexto(a.nome_operacional)
  }
  return (
    <input
      aria-label={`Nome operacional de ${a.nome_operacional}`}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setTexto(a.nome_operacional)
      }}
    />
  )
}

/** Nomes citados nos casos para revisar (para destacar as linhas). */
function motivosPorNome(revisar: ItemRevisar[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of revisar) {
    for (const n of [r.nome, ...(r.nomes ?? [])]) {
      if (!n) continue
      m.set(n, [...(m.get(n) ?? []), r.motivo])
    }
  }
  return m
}

const ZOOMS = [1, 1.5, 2, 3]

export default function Ambientes({
  pagina,
  imagem: img,
  mascaras,
  chaveImagem,
  ambientes,
  revisar,
  ignorados,
  ajustados,
  acoes,
}: {
  pagina: PaginaAberta
  imagem: ImagemCalculada
  mascaras: Retangulo[]
  chaveImagem: string
  ambientes: Ambiente[]
  revisar: ItemRevisar[]
  ignorados: string[]
  ajustados: Set<string>
  acoes: AcoesAmbientes
}) {
  const { imagem, erro } = usePrevia(() => pagina.recorte(img, mascaras), chaveImagem)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [arrasto, setArrasto] = useState<{ id: string; indice: number; x: number; y: number } | null>(null)
  const [incluindo, setIncluindo] = useState(false)
  const [novo, setNovo] = useState<{ x: number; y: number; nome: string; categoria: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  const motivos = useMemo(() => motivosPorNome(revisar), [revisar])
  const W = pagina.largura
  const H = pagina.altura
  const raio = img.largura / 160

  // Ponto normalizado da página ↔ pixel da imagem (o pixel 0 é o canto do pixmap).
  const paraImagem = (x: number, y: number): [number, number] => [x * W * img.escala - img.origem[0], y * H * img.escala - img.origem[1]]
  function paraPagina(e: { clientX: number; clientY: number }, svg: Element): [number, number] {
    const [u, v] = pontoNormalizado(e, svg)
    return [(u * img.largura + img.origem[0]) / img.escala / W, (v * img.altura + img.origem[1]) / img.escala / H]
  }

  function inicioArrasto(e: EventoPonteiro<SVGElement>, a: Ambiente, indice: number) {
    e.stopPropagation()
    e.preventDefault()
    svgDoEvento(e)?.setPointerCapture?.(e.pointerId)
    setSelecionado(a.id)
    const m = a.marcadores[indice]
    setArrasto({ id: a.id, indice, x: m.x, y: m.y })
  }

  function mover(e: EventoPonteiro<SVGSVGElement>) {
    if (!arrasto) return
    const [x, y] = paraPagina(e, e.currentTarget)
    setArrasto({ ...arrasto, x, y })
  }

  function soltar() {
    if (!arrasto) return
    const a = ambientes.find((x) => x.id === arrasto.id)
    const m = a?.marcadores[arrasto.indice]
    if (a && m && (Math.abs(m.x - arrasto.x) > 1e-5 || Math.abs(m.y - arrasto.y) > 1e-5)) {
      acoes.moverPino(a, arrasto.indice, arrasto.x, arrasto.y)
    }
    setArrasto(null)
  }

  function clicarPlanta(e: EventoPonteiro<SVGSVGElement>) {
    if (!incluindo) return
    const [x, y] = paraPagina(e, e.currentTarget)
    setNovo({ x, y, nome: '', categoria: 'area_comum' })
    setIncluindo(false)
  }

  function pino(a: Ambiente, indice: number) {
    const emArrasto = arrasto && arrasto.id === a.id && arrasto.indice === indice
    const m = emArrasto ? arrasto : a.marcadores[indice]
    const [cx, topo] = paraImagem(m.x, m.y)
    const ponta = topo - raio * 0.35
    const cy = ponta - raio * 2
    const sel = selecionado === a.id
    return (
      <g
        key={`${a.id}-${indice}`}
        className={`adm-pino${sel ? ' adm-pino-sel' : ''}`}
        data-testid={`pino-${a.id}-${indice}`}
        role="button"
        aria-label={`Pino ${indice + 1} de ${a.nome_operacional}`}
        onPointerDown={(e) => inicioArrasto(e, a, indice)}
      >
        <title>{a.nome_operacional}</title>
        <path
          d={`M ${cx - raio * 0.75} ${cy + raio * 0.6} L ${cx + raio * 0.75} ${cy + raio * 0.6} L ${cx} ${ponta} Z`}
        />
        <circle cx={cx} cy={cy} r={raio} />
        <circle cx={cx} cy={cy} r={raio * 0.38} className="adm-pino-miolo" />
      </g>
    )
  }

  return (
    <section aria-labelledby="titulo-ambientes">
      <h2 id="titulo-ambientes">Ambientes</h2>
      {revisar.length > 0 && (
        <details className="adm-alerta adm-alerta-aviso" open>
          <summary>{revisar.length} caso(s) para conferir</summary>
          <ul>
            {revisar.map((r, i) => (
              <li key={i}>
                {r.motivo}: {r.nome ?? r.nomes?.join(', ') ?? r.rotulo}
              </li>
            ))}
          </ul>
        </details>
      )}
      {ignorados.length > 0 && (
        <div className="adm-alerta adm-alerta-info">
          <p>Itens da configuração que não valem para esta planta (ficam de fora ao publicar):</p>
          <ul>
            {ignorados.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="adm-editor-ambientes">
        <div className="adm-editor-tabela">
          <table className="adm-tabela adm-tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Nome operacional</th>
                <th scope="col">Na planta</th>
                <th scope="col">Categoria</th>
                <th scope="col" className="adm-num">
                  Área (m²)
                </th>
                <th scope="col">Pinos</th>
              </tr>
            </thead>
            <tbody>
              {ambientes.map((a) => {
                const casos = motivos.get(a.nome_operacional)
                return (
                  <tr
                    key={a.id}
                    className={[selecionado === a.id ? 'adm-linha-sel' : '', casos ? 'adm-linha-revisar' : ''].join(' ')}
                    onClick={() => setSelecionado(a.id)}
                    data-testid={`linha-${a.id}`}
                  >
                    <td>
                      <NomeEditavel key={a.nome_operacional} a={a} onRenomear={(n) => acoes.renomear(a, n)} />
                      <code className="adm-codigo">{a.id}</code>
                      {casos && (
                        <span className="adm-selo adm-selo-revisar" title={casos.join('; ')}>
                          revisar
                        </span>
                      )}
                    </td>
                    <td>{a.nome_planta ?? <em>sem rótulo</em>}</td>
                    <td>
                      <SelectCategoria
                        valor={a.categoria}
                        rotulo={`Categoria de ${a.nome_operacional}`}
                        onMudar={(c) => acoes.categoria(a, c)}
                      />
                    </td>
                    <td className="adm-num">{a.area_m2 === null ? '—' : a.area_m2.toLocaleString('pt-BR')}</td>
                    <td>
                      {a.marcadores.length}
                      {a.marcadores.length > 1 &&
                        a.marcadores.map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            className="adm-botao adm-botao-discreto adm-botao-mini"
                            onClick={() => acoes.removerPino(a, i)}
                          >
                            Remover pino {i + 1}
                          </button>
                        ))}
                      {ajustados.has(a.id) && (
                        <button
                          type="button"
                          className="adm-botao adm-botao-discreto adm-botao-mini"
                          onClick={() => acoes.restaurarPinos(a)}
                        >
                          Voltar pinos ao rótulo
                        </button>
                      )}
                      {ehManual(a) && (
                        <button
                          type="button"
                          className="adm-botao adm-botao-discreto adm-botao-mini"
                          onClick={() => acoes.removerManual(a)}
                        >
                          Remover ambiente
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="adm-dica">
            A categoria de um ambiente rotulado vale para todos os rótulos com o mesmo nome na planta. Renomear um ambiente
            já publicado mantém o código dele (e os registros).
          </p>
        </div>
        <div className="adm-editor-planta">
          <div className="adm-acoes">
            <button
              type="button"
              className={`adm-botao${incluindo ? ' adm-botao-principal' : ''}`}
              aria-pressed={incluindo}
              onClick={() => {
                setIncluindo(!incluindo)
                setNovo(null)
              }}
            >
              {incluindo ? 'Clique na planta onde fica o ambiente…' : 'Incluir ambiente sem rótulo'}
            </button>
            <label className="adm-opcao">
              Zoom
              <select aria-label="Zoom da planta" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {z * 100}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          {novo && (
            <form
              className="adm-novo-ambiente"
              onSubmit={(e) => {
                e.preventDefault()
                acoes.incluir(novo.nome, novo.categoria, novo.x, novo.y)
                setNovo(null)
              }}
            >
              <label>
                Nome do ambiente
                <input autoFocus value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required />
              </label>
              <label>
                Categoria
                <SelectCategoria valor={novo.categoria} rotulo="Categoria do ambiente novo" onMudar={(c) => setNovo({ ...novo, categoria: c })} />
              </label>
              <div className="adm-acoes">
                <button type="submit" className="adm-botao adm-botao-principal">
                  Incluir
                </button>
                <button type="button" className="adm-botao" onClick={() => setNovo(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
          {erro && (
            <p className="adm-alerta adm-alerta-erro" role="alert">
              {erro}
            </p>
          )}
          <div className="adm-rolagem">
            <div className="adm-prancha" style={{ width: `${zoom * 100}%` }}>
              {imagem ? (
                <img src={imagem.url} alt="Planta recortada" draggable={false} />
              ) : (
                !erro && <p className="adm-estado">Desenhando a planta…</p>
              )}
              <svg
                viewBox={`0 0 ${img.largura} ${img.altura}`}
                preserveAspectRatio="none"
                className={`adm-sobreposicao${incluindo ? ' adm-cursor-mira' : ''}`}
                aria-label="Pinos dos ambientes"
                onPointerMove={mover}
                onPointerUp={soltar}
                onPointerCancel={soltar}
                onPointerDown={clicarPlanta}
              >
                {ambientes.flatMap((a) => a.marcadores.map((_, i) => pino(a, i)))}
                {novo && <circle cx={paraImagem(novo.x, novo.y)[0]} cy={paraImagem(novo.x, novo.y)[1]} r={raio} className="adm-pino-novo" />}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
