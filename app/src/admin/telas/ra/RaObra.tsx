/**
 * Realidade aumentada da obra (`/admin/obras/<slug>/ra`): ambientes com geometria, posição do QR
 * na parede e a folha A4 para imprimir (QR no tamanho físico cadastrado).
 */
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ComDados, Resultado } from '../../componentes.tsx'
import { useAmbientesRA, useDefinirQr, useObraAdmin, useRemoverQr } from '../../dados/hooks.ts'
import type { AmbienteRA, ObraAdmin } from '../../dados/tipos.ts'
import {
  ALTURA_PADRAO_M,
  LADO_MAX_A4_CM,
  LADO_PADRAO_CM,
  comprimentoParede,
  formatar,
  normalExterna,
  paraCampo,
  pontoNaParede,
  validarQr,
  type CamposQr,
  type Ponto,
} from '../../ra/geometria.ts'
import { APP_PADRAO, gerarQr, textoQr } from '../../ra/qr.ts'

const SEM_GEOMETRIA = 'Esta obra ainda não tem a geometria dos ambientes. Rode scripts/gerar_geometria.py e aplique o seed.'

export default function RaObra() {
  const { slug = '' } = useParams()
  const obra = useObraAdmin(slug)
  return <ComDados consulta={obra}>{(o) => <Pagina obra={o} />}</ComDados>
}

function Pagina({ obra }: { obra: ObraAdmin }) {
  const consulta = useAmbientesRA(obra.obra.id)
  const [aberto, setAberto] = useState<string | null>(null)
  return (
    <article aria-labelledby="titulo-ra">
      <div className="ra-tela">
        <p>
          <Link to={`/obras/${obra.obra.slug}`}>← {obra.obra.nome}</Link>
        </p>
        <h1 id="titulo-ra">Realidade aumentada · {obra.obra.nome}</h1>
        <p className="adm-dica">
          O QR de cada ambiente é fixado na parede e lido pelo Mini App para alinhar o modelo 3D com a obra. Escolha o
          ambiente, marque a posição do QR na parede e imprima.
        </p>
      </div>
      <ComDados consulta={consulta}>
        {(ambientes) => {
          if (ambientes.length === 0) {
            return (
              <p className="adm-alerta adm-alerta-info ra-tela" role="status">
                {SEM_GEOMETRIA}
              </p>
            )
          }
          const atual = ambientes.find((a) => a.ambiente_id === aberto)
          if (atual) {
            return <Ambiente key={atual.ambiente_id} obra={obra} ambiente={atual} onVoltar={() => setAberto(null)} />
          }
          return <Lista ambientes={ambientes} onAbrir={setAberto} />
        }}
      </ComDados>
    </article>
  )
}

// --- Lista -----------------------------------------------------------------------------------

function Lista({ ambientes, onAbrir }: { ambientes: AmbienteRA[]; onAbrir: (id: string) => void }) {
  const grupos: { pavimento: string; itens: AmbienteRA[] }[] = []
  for (const a of ambientes) {
    const g = grupos.find((x) => x.pavimento === a.pavimento)
    if (g) g.itens.push(a)
    else grupos.push({ pavimento: a.pavimento, itens: [a] })
  }
  return (
    <div className="ra-tela">
      {grupos.map((g) => (
        <section key={g.pavimento} className="adm-secao" aria-label={g.pavimento}>
          <h2>{g.pavimento}</h2>
          <table className="adm-tabela">
            <thead>
              <tr>
                <th scope="col">Ambiente</th>
                <th scope="col">Código</th>
                <th scope="col">QR</th>
                <th scope="col">
                  <span className="adm-oculto">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {g.itens.map((a) => (
                <tr key={a.ambiente_id} data-testid={`ra-${a.codigo}`}>
                  <td>{a.nome}</td>
                  <td>
                    <code>{a.codigo}</code>
                  </td>
                  <td>
                    {a.qr ? (
                      <span className="adm-selo adm-selo-revisado">Com QR</span>
                    ) : (
                      <span className="adm-selo adm-selo-aguardando">Sem QR</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="adm-botao"
                      aria-label={`Abrir ${a.nome}`}
                      onClick={() => onAbrir(a.ambiente_id)}
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

// --- Ambiente --------------------------------------------------------------------------------

function camposIniciais(a: AmbienteRA): CamposQr & { parede: number } {
  if (a.qr) {
    return {
      parede: a.qr.parede,
      distancia: paraCampo(a.qr.distancia_m),
      altura: paraCampo(a.qr.altura_m),
      ladoCm: paraCampo(a.qr.lado_m * 100, 0, 2),
    }
  }
  return {
    parede: 0,
    distancia: paraCampo(comprimentoParede(a.contorno, 0) / 2),
    altura: paraCampo(ALTURA_PADRAO_M),
    ladoCm: String(LADO_PADRAO_CM),
  }
}

function Ambiente({ obra, ambiente, onVoltar }: { obra: ObraAdmin; ambiente: AmbienteRA; onVoltar: () => void }) {
  const definir = useDefinirQr()
  const remover = useRemoverQr()
  const [campos, setCampos] = useState(() => camposIniciais(ambiente))
  const [confirmando, setConfirmando] = useState(false)
  const [salvo, setSalvo] = useState<string | null>(null)
  const { qr, erros } = validarQr(ambiente.contorno, campos)
  const n = ambiente.contorno.length

  const gravado = ambiente.qr !== null
  const g = ambiente.qr
  const alterado =
    !qr ||
    !g ||
    qr.parede !== g.parede ||
    Math.abs(qr.distancia_m - g.distancia_m) > 1e-9 ||
    Math.abs(qr.altura_m - g.altura_m) > 1e-9 ||
    Math.abs(qr.lado_m - g.lado_m) > 1e-9
  const podeImprimir = gravado && !alterado && qr !== null

  function mudar(campo: keyof CamposQr, valor: string | number) {
    setSalvo(null)
    setCampos((c) => {
      const novo = { ...c, [campo]: valor }
      if (campo === 'parede') {
        // Ao trocar de parede, a distância volta para o meio dela.
        novo.distancia = paraCampo(comprimentoParede(ambiente.contorno, Number(valor)) / 2)
      }
      return novo
    })
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!qr) return
    definir.mutate({ ambienteId: ambiente.ambiente_id, qr }, { onSuccess: () => setSalvo('QR salvo.') })
  }

  function confirmarRemocao() {
    remover.mutate(ambiente.ambiente_id, {
      onSuccess: () => {
        setConfirmando(false)
        setSalvo('QR removido.')
        setCampos({ ...camposIniciais({ ...ambiente, qr: null }) })
      },
    })
  }

  const erroCampos = erros.distancia ?? erros.altura ?? erros.lado ?? null

  return (
    <>
      <div className="ra-tela">
        <p>
          <button type="button" className="adm-botao adm-botao-discreto" onClick={onVoltar}>
            ← Ambientes
          </button>
        </p>
        <h2 id="titulo-ambiente">
          {ambiente.nome} <span className="adm-dica">· {ambiente.pavimento} · {ambiente.codigo}</span>
        </h2>
        <div className="ra-ambiente">
          <Desenho contorno={ambiente.contorno} qr={qr} />
          <div>
            <table className="adm-tabela adm-tabela-compacta" aria-label="Paredes">
              <thead>
                <tr>
                  <th scope="col">Parede</th>
                  <th scope="col">Cantos</th>
                  <th scope="col" className="adm-num">
                    Comprimento
                  </th>
                </tr>
              </thead>
              <tbody>
                {ambiente.contorno.map((_, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      {i + 1} → {((i + 1) % n) + 1}
                    </td>
                    <td className="adm-num">{formatar(comprimentoParede(ambiente.contorno, i))} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form className="adm-form" onSubmit={enviar} noValidate>
              <label>
                Parede
                <select value={campos.parede} onChange={(e) => mudar('parede', Number(e.target.value))}>
                  {ambiente.contorno.map((_, i) => (
                    <option key={i} value={i}>
                      Parede {i + 1} ({formatar(comprimentoParede(ambiente.contorno, i))} m)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Distância a partir do canto {campos.parede + 1} (m)
                <input
                  value={campos.distancia}
                  inputMode="decimal"
                  onChange={(e) => mudar('distancia', e.target.value)}
                  aria-invalid={erros.distancia ? true : undefined}
                />
              </label>
              <label>
                Altura do centro do QR acima do piso (m)
                <input
                  value={campos.altura}
                  inputMode="decimal"
                  onChange={(e) => mudar('altura', e.target.value)}
                  aria-invalid={erros.altura ? true : undefined}
                />
              </label>
              <label>
                Lado do QR (cm)
                <input
                  value={campos.ladoCm}
                  inputMode="decimal"
                  onChange={(e) => mudar('ladoCm', e.target.value)}
                  aria-invalid={erros.lado ? true : undefined}
                />
                <span className="adm-dica">Lado do quadrado do QR, sem a margem branca.</span>
              </label>
              {qr && qr.lado_m * 100 > LADO_MAX_A4_CM && (
                <p className="adm-alerta adm-alerta-aviso">
                  Com mais de {LADO_MAX_A4_CM} cm, o QR não cabe numa folha A4 com a margem branca.
                </p>
              )}
              <Resultado sucesso={salvo} erro={erroCampos ? new Error(erroCampos) : (definir.error ?? remover.error)} />
              <div className="adm-acoes">
                <button type="submit" className="adm-botao adm-botao-principal" disabled={!qr || definir.isPending}>
                  Salvar
                </button>
                {gravado && !confirmando && (
                  <button type="button" className="adm-botao adm-botao-perigo" onClick={() => setConfirmando(true)}>
                    Remover QR
                  </button>
                )}
                <button
                  type="button"
                  className="adm-botao"
                  disabled={!podeImprimir}
                  title={podeImprimir ? undefined : 'Salve o QR antes de imprimir'}
                  onClick={() => window.print()}
                >
                  Imprimir
                </button>
              </div>
              {confirmando && (
                <div className="adm-alerta adm-alerta-aviso" role="alertdialog" aria-label="Confirmar remoção">
                  <p>Remover o QR de {ambiente.nome}? O Mini App deixa de alinhar por ele.</p>
                  <div className="adm-acoes">
                    <button
                      type="button"
                      className="adm-botao adm-botao-perigo"
                      disabled={remover.isPending}
                      onClick={confirmarRemocao}
                    >
                      Confirmar remoção
                    </button>
                    <button type="button" className="adm-botao" onClick={() => setConfirmando(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
      {podeImprimir && ambiente.qr && <Folha obra={obra} ambiente={ambiente} qr={ambiente.qr} />}
    </>
  )
}

// --- Desenho ---------------------------------------------------------------------------------

function Desenho({ contorno, qr }: { contorno: Ponto[]; qr: { parede: number; distancia_m: number; lado_m: number } | null }) {
  const xs = contorno.map((p) => p[0])
  const zs = contorno.map((p) => p[1])
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const larg = Math.max(...xs) - minX
  const alt = Math.max(...zs) - minZ
  const grande = Math.max(larg, alt, 1)
  const fonte = grande * 0.04
  const folga = grande * 0.14
  const caixa = `${minX - folga} ${minZ - folga} ${larg + 2 * folga} ${alt + 2 * folga}`
  const pontos = contorno.map(([x, z]) => `${x},${z}`).join(' ')
  const n = contorno.length

  let marca: { a: Ponto; b: Ponto; centro: Ponto } | null = null
  if (qr) {
    const { ponto, direcao } = pontoNaParede(contorno, qr.parede, qr.distancia_m)
    const meio = qr.lado_m / 2
    marca = {
      centro: ponto,
      a: [ponto[0] - direcao[0] * meio, ponto[1] - direcao[1] * meio],
      b: [ponto[0] + direcao[0] * meio, ponto[1] + direcao[1] * meio],
    }
  }

  return (
    <svg
      className="ra-desenho"
      viewBox={caixa}
      role="img"
      aria-label="Contorno do ambiente visto de cima"
      data-testid="ra-desenho"
    >
      <polygon points={pontos} className="ra-piso" />
      {contorno.map((_, i) => {
        const { ponto } = pontoNaParede(contorno, i, comprimentoParede(contorno, i) / 2)
        const [nx, nz] = normalExterna(contorno, i)
        const afast = fonte * 1.6
        return (
          <text
            key={`p${i}`}
            className="ra-rotulo"
            x={ponto[0] + nx * afast}
            y={ponto[1] + nz * afast}
            fontSize={fonte}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {i + 1}: {formatar(comprimentoParede(contorno, i))} m
          </text>
        )
      })}
      {contorno.map(([x, z], i) => {
        // Canto i+1 fica entre a normal da parede anterior e a da seguinte (para fora).
        const [ax, az] = normalExterna(contorno, (i - 1 + n) % n)
        const [bx, bz] = normalExterna(contorno, i)
        const norma = Math.hypot(ax + bx, az + bz) || 1
        const afast = fonte * 1.1
        return (
          <g key={`c${i}`}>
            <circle cx={x} cy={z} r={fonte * 0.28} className="ra-canto" />
            <text
              className="ra-canto-num"
              x={x + ((ax + bx) / norma) * afast}
              y={z + ((az + bz) / norma) * afast}
              fontSize={fonte * 0.9}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {i + 1}
            </text>
          </g>
        )
      })}
      {marca && (
        <g data-testid="ra-marca">
          <line x1={marca.a[0]} y1={marca.a[1]} x2={marca.b[0]} y2={marca.b[1]} className="ra-qr" strokeWidth={fonte * 0.5} />
          <circle cx={marca.centro[0]} cy={marca.centro[1]} r={fonte * 0.35} className="ra-qr-centro" />
        </g>
      )}
    </svg>
  )
}

// --- Folha de impressão ----------------------------------------------------------------------

function Folha({ obra, ambiente, qr }: { obra: ObraAdmin; ambiente: AmbienteRA; qr: NonNullable<AmbienteRA['qr']> }) {
  const bot = String(import.meta.env.VITE_TELEGRAM_BOT ?? '')
  const app = String(import.meta.env.VITE_TELEGRAM_APP ?? '') || APP_PADRAO
  const texto = textoQr(bot, app, obra.obra.slug, ambiente.codigo)
  const gerado = gerarQr(texto)
  const ladoMm = qr.lado_m * 1000
  const modulo = ladoMm / gerado.tamanho
  const margem = modulo * 4
  return (
    <section className="ra-folha" aria-label="Folha para impressão" data-testid="ra-folha">
      <p className="ra-folha-obra">{obra.obra.nome}</p>
      <h2 className="ra-folha-titulo">{ambiente.nome}</h2>
      <p className="ra-folha-sub">
        {ambiente.pavimento} · {ambiente.codigo}
      </p>
      <div className="ra-folha-qr" style={{ padding: `${margem}mm` }}>
        <svg
          data-testid="ra-qr-svg"
          xmlns="http://www.w3.org/2000/svg"
          width={`${ladoMm}mm`}
          height={`${ladoMm}mm`}
          viewBox={`0 0 ${gerado.tamanho} ${gerado.tamanho}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`QR code de ${ambiente.nome}`}
        >
          <path d={gerado.caminho} fill="#000" />
        </svg>
      </div>
      <p className="ra-folha-instrucao">
        Fixar na parede {qr.parede + 1}, a {formatar(qr.distancia_m)} m do canto {qr.parede + 1}, com o centro a{' '}
        {formatar(qr.altura_m)} m do piso. Bordas no prumo.
      </p>
      <p className="ra-folha-aviso">Imprimir em 100% (sem ajustar à página)</p>
      <svg className="ra-regua" width="100mm" height="9mm" viewBox="0 0 100 9" aria-label="Régua de 10 cm">
        <rect x="0.15" y="0.15" width="99.7" height="5" fill="none" stroke="#000" strokeWidth="0.3" />
        {Array.from({ length: 11 }, (_, i) => (
          <line key={i} x1={i * 10} y1="0" x2={i * 10} y2={i % 5 === 0 ? 5 : 3} stroke="#000" strokeWidth="0.3" />
        ))}
        <text x="50" y="8.4" fontSize="3" textAnchor="middle" fill="#000">
          10 cm
        </text>
      </svg>
      <p className="ra-folha-rodape">
        Conferir a régua antes de fixar · {texto}
      </p>
    </section>
  )
}
