import { useCallback, useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from 'react'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { marcadorParaPixel } from '../util/coordenadas.ts'
import { abrirCamera, capturarPar, fecharCamera } from './camera.ts'
import { cantoNoMundo, qrEDoAmbiente, qrNoMundo, type GeometriaAmbiente, type Plano } from './geometria.ts'
import { criarLeitorQr } from './leitorQr.ts'
import { MotorRA } from './motor.ts'
import { iniciarOrientacao, type Orientacao } from './orientacao.ts'
import {
  erroDoToque,
  resolverPorCantos,
  resolverPorQr,
  type LeituraQr,
  type Ponto2,
  type Pose,
  type Toque,
} from './pose.ts'
import type { FotoRA } from './tipos.ts'
import './ra.css'

const CHAVE_FOV = 'ra-fov'
const FOV_PADRAO = 60
const FOV_MINIMO = 35
const FOV_MAXIMO = 95
const OPACIDADE_PADRAO = 0.7
/** Altura típica do celular na mão, acima do piso (desempate do alinhamento). */
const ALTURA_DA_MAO = 1.4

type Base = { tipo: 'cantos'; a: Toque; b: Toque } | { tipo: 'qr'; leitura: LeituraQr }
type Fase = 'inicio' | 'abrindo' | 'alinhar' | 'pronto' | 'erro'
interface Pendente {
  ndc: Ponto2
  q: Toque['q']
  para: 'primeiro' | 'segundo' | 'conferir'
}

export interface PlantaRA {
  url?: string
  pagina_pt: [number, number]
  recorte_pt: [number, number, number, number]
  largura: number
  altura: number
}

export interface PropsTelaRA {
  obra: { slug: string; nome: string }
  pavimento: string
  ambiente: { codigo: string; nome: string }
  geometria: GeometriaAmbiente
  modelos: ModeloFrag[]
  baixar: (m: ModeloFrag) => Promise<ArrayBuffer>
  /** Quantas fotos ainda cabem no registro (cada disparo usa duas). */
  vagas: number
  /** Recorte da planta com o cômodo, para a folha de escolha dos cantos e a miniatura. */
  planta?: PlantaRA | null
  onConcluir: (fotos: FotoRA[]) => void
  onFechar: () => void
}

function fovGuardado(): number {
  try {
    const v = Number(localStorage.getItem(CHAVE_FOV))
    return v >= FOV_MINIMO && v <= FOV_MAXIMO ? v : FOV_PADRAO
  } catch {
    return FOV_PADRAO
  }
}

function resolver(base: Base, g: GeometriaAmbiente, fov: number, aspecto: number): Pose | null {
  if (base.tipo === 'cantos') return resolverPorCantos(base.a, base.b, fov, aspecto, g.yPiso + ALTURA_DA_MAO)
  const qr = qrNoMundo(g)
  return qr ? resolverPorQr(base.leitura, qr, fov, aspecto) : null
}

/** Tela de realidade aumentada: câmera ao vivo, modelo sobreposto, alinhamento e captura. */
export default function TelaRA(props: PropsTelaRA) {
  const { obra, pavimento, ambiente, geometria, modelos, baixar, vagas, planta, onConcluir, onFechar } = props
  const palco = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const motor = useRef<MotorRA | null>(null)
  const orientacao = useRef<Orientacao | null>(null)
  const fluxo = useRef<MediaStream | null>(null)
  const aspecto = useRef(9 / 16)
  const poseAtual = useRef<Pose | null>(null)
  const fovAtual = useRef(FOV_PADRAO)
  const opacidadeAtual = useRef(OPACIDADE_PADRAO)

  const [fase, setFase] = useState<Fase>('inicio')
  const [mensagem, setMensagem] = useState('')
  const [carga, setCarga] = useState('')
  const [semSensor, setSemSensor] = useState(false)
  const [base, setBase] = useState<Base | null>(null)
  const [ajuste, setAjuste] = useState({ rumo: 0, altura: 0 })
  const [fov, setFov] = useState(fovGuardado)
  const [primeiro, setPrimeiro] = useState<{
    toque: Toque
    canto: number
  } | null>(null)
  const [pendente, setPendente] = useState<Pendente | null>(null)
  const [plano, setPlano] = useState<Plano>('piso')
  const [conferindo, setConferindo] = useState(false)
  const [erroCm, setErroCm] = useState<number | null>(null)
  const [lendoQr, setLendoQr] = useState(false)
  const [opacidade, setOpacidade] = useState(OPACIDADE_PADRAO)
  // A arquitetura cobre a imagem inteira: começa desligada quando há outra disciplina.
  const [desligados, setDesligados] = useState<ReadonlySet<string>>(() => {
    const referencia = geometria.referencial?.sigla ?? 'ARQ'
    return new Set(modelos.some((m) => m.sigla !== referencia) ? [referencia] : [])
  })
  const [malha, setMalha] = useState(true)
  const [fotos, setFotos] = useState<FotoRA[]>([])
  const [capturando, setCapturando] = useState(false)
  const [aviso, setAviso] = useState('')

  const visiveis = modelos.filter((m) => !desligados.has(m.sigla))
  const cabe = vagas - fotos.length >= 2

  // Pose = alinhamento de base + ajuste fino. Recalcula quando o ângulo de visão muda.
  useEffect(() => {
    fovAtual.current = fov
    if (!base) {
      poseAtual.current = null
      return
    }
    const p = resolver(base, geometria, fov, aspecto.current)
    if (!p) return
    p.rumo += ajuste.rumo
    p.posicao.y += ajuste.altura
    poseAtual.current = p
  }, [base, ajuste, fov, geometria])

  useEffect(() => {
    motor.current?.definirMalha(malha)
  }, [malha, fase])

  useEffect(() => {
    opacidadeAtual.current = opacidade
  }, [opacidade])

  useEffect(() => {
    motor.current?.definirVisiveis(new Set(visiveis.map((m) => m.sigla)))
    // `visiveis` é derivado de `modelos` e `desligados`.
  }, [modelos, desligados]) // eslint-disable-line react-hooks/exhaustive-deps

  // Encerra câmera, sensores e a cena ao sair.
  useEffect(
    () => () => {
      fecharCamera(fluxo.current)
      orientacao.current?.parar()
      motor.current?.descartar()
      motor.current = null
    },
    [],
  )

  // Laço de desenho e acompanhamento do tamanho do palco.
  useEffect(() => {
    if (fase !== 'alinhar' && fase !== 'pronto') return
    const el = palco.current
    if (!el) return
    const medir = () => {
      aspecto.current = el.clientWidth / Math.max(1, el.clientHeight)
      motor.current?.redimensionar(el.clientWidth, el.clientHeight)
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    let quadro = 0
    const desenhar = () => {
      quadro = requestAnimationFrame(desenhar)
      const m = motor.current
      const o = orientacao.current
      if (!m || !o) return
      if (poseAtual.current) {
        m.posicionar(poseAtual.current, o.atual(), fovAtual.current)
        m.renderizar()
      } else {
        m.posicionarProcura(o.atual(), fovAtual.current)
        m.renderizar()
      }
    }
    quadro = requestAnimationFrame(desenhar)
    return () => {
      cancelAnimationFrame(quadro)
      observador.disconnect()
    }
  }, [fase])

  // Avisa enquanto o aparelho não entregar nenhuma leitura de orientação.
  useEffect(() => {
    if (fase !== 'alinhar' && fase !== 'pronto') return
    const t = setInterval(() => setSemSensor(orientacao.current?.leituras() === 0), 1500)
    return () => clearInterval(t)
  }, [fase])

  // O pedido de permissão dos sensores (iPhone) precisa partir de um toque: por isso o botão.
  async function comecar() {
    if (!video.current || !canvas.current) return
    setFase('abrindo')
    try {
      const [o, f] = await Promise.all([iniciarOrientacao(), abrirCamera(video.current)])
      orientacao.current = o
      fluxo.current = f
      const m = new MotorRA(canvas.current, geometria)
      motor.current = m
      setFase('alinhar')
      await m.carregar(modelos, baixar, setCarga)
      m.definirVisiveis(new Set(modelos.filter((x) => !desligados.has(x.sigla)).map((x) => x.sigla)))
      m.definirMalha(malha)
      setCarga('')
    } catch (e) {
      setMensagem(e instanceof Error && e.message ? e.message : 'Não foi possível abrir a realidade aumentada.')
      setFase('erro')
    }
  }

  function realinhar() {
    setBase(null)
    setPrimeiro(null)
    setPendente(null)
    setConferindo(false)
    setErroCm(null)
    setAjuste({ rumo: 0, altura: 0 })
    setAviso('')
    setFase('alinhar')
  }

  function escolherCanto(indice: number) {
    if (!pendente) return
    const toque: Toque = {
      ndc: pendente.ndc,
      q: pendente.q,
      alvo: cantoNoMundo(geometria, indice, plano),
    }
    setPendente(null)
    if (pendente.para === 'primeiro') {
      setPrimeiro({ toque, canto: indice })
      return
    }
    if (pendente.para === 'segundo' && primeiro) {
      const nova: Base = { tipo: 'cantos', a: primeiro.toque, b: toque }
      if (!resolver(nova, geometria, fovAtual.current, aspecto.current)) {
        setAviso('Não deu para alinhar com esses dois cantos. Escolha cantos mais afastados e tente de novo.')
        setPrimeiro(null)
        return
      }
      setAviso('')
      setBase(nova)
      setFase('pronto')
      return
    }
    if (pendente.para === 'conferir' && poseAtual.current) {
      const erro = erroDoToque(poseAtual.current, toque, fovAtual.current, aspecto.current)
      setErroCm(erro === null ? null : Math.round(erro * 1000) / 10)
      setConferindo(false)
    }
  }

  // Leitura do QR: tenta a cada 300 ms até achar o QR deste ambiente.
  useEffect(() => {
    if (!lendoQr) return
    let ativo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      const leitor = await criarLeitorQr()
      const tentar = async () => {
        if (!ativo || !video.current || !orientacao.current) return
        const q = orientacao.current.atual()
        const lido = await leitor.ler(video.current, aspecto.current)
        if (!ativo) return
        if (lido && !qrEDoAmbiente(lido.texto, obra.slug, ambiente.codigo)) {
          setAviso('Este QR é de outro ambiente.')
        } else if (lido) {
          const nova: Base = {
            tipo: 'qr',
            leitura: { cantos: lido.cantos, q },
          }
          if (resolver(nova, geometria, fovAtual.current, aspecto.current)) {
            setAviso('')
            setAjuste({ rumo: 0, altura: 0 })
            setErroCm(null)
            setBase(nova)
            setLendoQr(false)
            setFase('pronto')
            return
          }
          setAviso('Aproxime-se do QR e mantenha o celular reto.')
        }
        temporizador = setTimeout(() => void tentar(), 300)
      }
      void tentar()
    })()
    return () => {
      ativo = false
      if (temporizador !== undefined) clearTimeout(temporizador)
    }
  }, [lendoQr, geometria, obra.slug, ambiente.codigo])

  // Toques e gestos sobre a imagem.
  const ponteiros = useRef(new Map<number, { x: number; y: number; x0: number; y0: number }>())
  const pinca = useRef<{ distancia: number; fov: number } | null>(null)

  function aoBaixar(e: EventoPonteiro<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    ponteiros.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      x0: e.clientX,
      y0: e.clientY,
    })
    if (ponteiros.current.size === 2) {
      const [p, q] = [...ponteiros.current.values()]
      pinca.current = {
        distancia: Math.hypot(p.x - q.x, p.y - q.y),
        fov: fovAtual.current,
      }
    }
  }

  function aoMover(e: EventoPonteiro<HTMLDivElement>) {
    const p = ponteiros.current.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (fase !== 'pronto' || conferindo) return
    const r = e.currentTarget.getBoundingClientRect()
    if (ponteiros.current.size === 2 && pinca.current) {
      const [a, b] = [...ponteiros.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d > 10) {
        setFov(Math.min(FOV_MAXIMO, Math.max(FOV_MINIMO, (pinca.current.fov * pinca.current.distancia) / d)))
      }
      return
    }
    if (ponteiros.current.size !== 1) return
    const fovHorizontal = 2 * Math.atan(Math.tan((fovAtual.current * Math.PI) / 360) * aspecto.current)
    setAjuste((a) => ({
      rumo: a.rumo + (dx / r.width) * fovHorizontal,
      altura: a.altura + (dy / r.height) * 0.6,
    }))
  }

  function aoSoltar(e: EventoPonteiro<HTMLDivElement>) {
    ponteiros.current.delete(e.pointerId)
    if (ponteiros.current.size < 2 && pinca.current) {
      pinca.current = null
      try {
        localStorage.setItem(CHAVE_FOV, String(Math.round(fovAtual.current * 10) / 10))
      } catch {
        // Sem armazenamento: o ajuste vale só para esta sessão.
      }
    }
  }

  /** A mira fica no centro: o raio do centro não depende do ângulo de visão. */
  function marcarCanto() {
    if (!orientacao.current || pendente || lendoQr) return
    const q = orientacao.current.atual()
    if (fase === 'alinhar') setPendente({ ndc: [0, 0], q, para: primeiro ? 'segundo' : 'primeiro' })
    else if (fase === 'pronto' && conferindo) setPendente({ ndc: [0, 0], q, para: 'conferir' })
  }

  const disparar = useCallback(async () => {
    const m = motor.current
    const pose = poseAtual.current
    if (!m || !pose || !video.current || !canvas.current || !base || capturando) return
    setCapturando(true)
    try {
      const agora = new Date()
      const par = await capturarPar({
        video: video.current,
        canvas3d: canvas.current,
        renderizar: () => m.renderizar({ semMalha: true }),
        opacidade: opacidadeAtual.current,
        aspectoTela: aspecto.current,
        faixa: [
          `${obra.nome} · ${pavimento} · ${ambiente.nome}`,
          `Modelo ${visiveis.map((v) => (v.revisao ? `${v.sigla} ${v.revisao}` : v.sigla)).join(', ') || '—'} · posição indicativa · ${agora.toLocaleString('pt-BR')}`,
        ],
      })
      const idLimpa = crypto.randomUUID()
      const idModelo = crypto.randomUUID()
      const dados = (parId: string): FotoRA['ra'] => ({
        par: parId,
        modelos: visiveis.map((v) => ({
          sigla: v.sigla,
          revisao: v.revisao,
          hash: v.hash,
        })),
        alinhamento: base.tipo,
        pose: {
          posicao: [pose.posicao.x, pose.posicao.y, pose.posicao.z].map((n) => Math.round(n * 1000) / 1000) as [
            number,
            number,
            number,
          ],
          rumo: Math.round(pose.rumo * 10000) / 10000,
          fov: Math.round(fovAtual.current * 10) / 10,
        },
        ...(erroCm === null ? {} : { erro_cm: erroCm }),
      })
      const carimbo = agora.getTime()
      const arquivo = (blob: Blob, nome: string) =>
        new File([blob], nome, { type: 'image/jpeg', lastModified: carimbo })
      setFotos((atuais) => [
        ...atuais,
        {
          id: idLimpa,
          arquivo: arquivo(par.limpa, `ra-${carimbo}-limpa.jpg`),
          origem: 'ra_limpa',
          ra: dados(idModelo),
        },
        {
          id: idModelo,
          arquivo: arquivo(par.comModelo, `ra-${carimbo}-modelo.jpg`),
          origem: 'ra_modelo',
          ra: dados(idLimpa),
        },
      ])
      setAviso('')
    } catch (e) {
      setAviso(e instanceof Error && e.message ? e.message : 'Não foi possível tirar a foto.')
    } finally {
      setCapturando(false)
    }
  }, [ambiente.nome, base, capturando, erroCm, obra.nome, pavimento, visiveis])

  const instrucao =
    fase === 'alinhar'
      ? lendoQr
        ? 'Aponte para o QR do ambiente'
        : primeiro
          ? `Canto ${primeiro.canto + 1} marcado. Sem sair do lugar, aponte para outro canto`
          : 'Aponte a mira para um canto do ambiente (encontro das paredes com o piso ou o teto) e toque em Marcar canto'
      : conferindo
        ? 'Aponte a mira para um terceiro canto e toque em Conferir este canto'
        : 'Arraste para girar ou subir o modelo; pinça ajusta o tamanho'

  return (
    <div className="ra" role="dialog" aria-modal="true" aria-label="Comparar com o modelo">
      <div className="ra-palco" ref={palco}>
        <video ref={video} className="ra-video" autoPlay muted playsInline />
        <canvas ref={canvas} className="ra-canvas" style={{ opacity: opacidade }} />
        {(fase === 'alinhar' || fase === 'pronto') && (
          <div
            className="ra-toque"
            data-testid="ra-toque"
            onPointerDown={aoBaixar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            onPointerCancel={(e) => ponteiros.current.delete(e.pointerId)}
          />
        )}
        {((fase === 'alinhar' && !lendoQr) || (fase === 'pronto' && conferindo)) && (
          <div className="ra-mira" data-testid="ra-mira" aria-hidden="true" />
        )}
      </div>

      <header className="ra-topo">
        <button type="button" className="ra-botao" onClick={onFechar} aria-label="Fechar">
          ×
        </button>
        <p className="ra-titulo">
          {ambiente.nome}
          <span>posição indicativa</span>
        </p>
        {fase === 'pronto' && (
          <button type="button" className="ra-botao ra-botao-texto" onClick={realinhar}>
            Alinhar de novo
          </button>
        )}
      </header>

      {fase === 'inicio' && (
        <div className="ra-cartao">
          <h2>Comparar com o modelo</h2>
          <p>
            A câmera mostra o modelo por cima do ambiente. Escolha um ponto para ficar, alinhe o modelo e tire as fotos
            sem sair do lugar. Se andar, alinhe de novo.
          </p>
          <p>Cada foto entra no registro duas vezes: limpa e com o modelo.</p>
          <button type="button" className="botao botao-bloco" onClick={() => void comecar()}>
            Abrir câmera
          </button>
        </div>
      )}
      {fase === 'abrindo' && (
        <p className="ra-cartao" role="status">
          Abrindo a câmera…
        </p>
      )}
      {fase === 'erro' && (
        <div className="ra-cartao" role="alert">
          <p>{mensagem}</p>
          <p>
            <a href="/ra-teste">Testar este aparelho</a>
          </p>
          <button type="button" className="botao botao-bloco" onClick={onFechar}>
            Voltar
          </button>
        </div>
      )}

      {(fase === 'alinhar' || fase === 'pronto') && (
        <div className="ra-base">
          <p className="ra-instrucao" role="status">
            {aviso || instrucao}
          </p>
          {carga && <p className="ra-nota">{carga}</p>}
          {semSensor && (
            <p className="ra-nota">
              Este aparelho não informa a orientação: mantenha o celular parado depois de alinhar.
            </p>
          )}
          {fase === 'alinhar' && !lendoQr && (
            <>
              <p className="ra-nota">Malha no piso estimado pela inclinação do celular</p>
              <button type="button" className="botao" disabled={!!pendente} onClick={marcarCanto}>
                Marcar canto
              </button>
            </>
          )}
          {fase === 'pronto' && conferindo && (
            <button type="button" className="botao" disabled={!!pendente} onClick={marcarCanto}>
              Conferir este canto
            </button>
          )}
          {erroCm !== null && <p className="ra-nota">Erro no canto conferido: {erroCm.toLocaleString('pt-BR')} cm</p>}

          {fase === 'alinhar' && geometria.qr && (
            <button type="button" className="ra-botao ra-botao-texto" onClick={() => setLendoQr((v) => !v)}>
              {lendoQr ? 'Usar os cantos' : 'Usar o QR do ambiente'}
            </button>
          )}

          {fase === 'pronto' && (
            <>
              <div className="ra-controles">
                <label className="ra-opacidade">
                  Modelo
                  <input
                    type="range"
                    min={0.15}
                    max={1}
                    step={0.05}
                    value={opacidade}
                    onChange={(e) => setOpacidade(Number(e.target.value))}
                    aria-label="Opacidade do modelo"
                  />
                </label>
                <ul className="ra-chips" aria-label="Modelos">
                  {modelos.map((m) => (
                    <li key={m.sigla}>
                      <button
                        type="button"
                        className="chip"
                        aria-pressed={!desligados.has(m.sigla)}
                        onClick={() =>
                          setDesligados((atual) => {
                            const novo = new Set(atual)
                            if (!novo.delete(m.sigla)) novo.add(m.sigla)
                            return novo
                          })
                        }
                      >
                        {m.sigla}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button type="button" className="chip" aria-pressed={malha} onClick={() => setMalha((v) => !v)}>
                      Malha
                    </button>
                  </li>
                </ul>
              </div>
              <div className="ra-acoes">
                <button
                  type="button"
                  className="ra-botao ra-botao-texto"
                  aria-pressed={conferindo}
                  onClick={() => setConferindo((v) => !v)}
                >
                  Conferir canto
                </button>
                <button
                  type="button"
                  className="ra-disparo"
                  aria-label="Tirar foto"
                  disabled={!cabe || capturando}
                  onClick={() => void disparar()}
                />
                <button
                  type="button"
                  className="ra-botao ra-botao-texto ra-concluir"
                  disabled={fotos.length === 0}
                  onClick={() => onConcluir(fotos)}
                >
                  Usar {fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}
                </button>
              </div>
              {!cabe && <p className="ra-nota">O registro não comporta mais fotos.</p>}
            </>
          )}
        </div>
      )}

      {fase === 'alinhar' && !lendoQr && !pendente && plantaReal(geometria, planta) && (
        <PlantaDosCantos geometria={geometria} planta={planta} bloqueado={primeiro?.canto ?? null} miniatura />
      )}

      {pendente && (
        <div className="ra-folha" role="dialog" aria-label="Qual canto você tocou?">
          <p className="ra-folha-titulo">Qual canto você tocou?</p>
          <div className="segmentado">
            <label>
              <input type="radio" name="ra-plano" checked={plano === 'piso'} onChange={() => setPlano('piso')} />
              <span>No piso</span>
            </label>
            <label>
              <input type="radio" name="ra-plano" checked={plano === 'teto'} onChange={() => setPlano('teto')} />
              <span>No teto</span>
            </label>
          </div>
          <PlantaDosCantos
            geometria={geometria}
            planta={planta}
            bloqueado={pendente.para === 'segundo' ? (primeiro?.canto ?? null) : null}
            onEscolher={escolherCanto}
          />
          <button type="button" className="botao botao-secundario botao-bloco" onClick={() => setPendente(null)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

type GeometriaComPagina = GeometriaAmbiente & { contornoPagina?: Ponto2[] }

/** Cantos do cômodo em pixels do recorte e viewBox que cobre a imagem e todos os cantos. */
function plantaReal(g: GeometriaComPagina, planta: PlantaRA | null | undefined) {
  const pagina = g.contornoPagina
  if (!planta || !pagina || pagina.length !== g.contorno.length || pagina.length === 0) return null
  const ref = {
    pagina_pt: planta.pagina_pt,
    recorte_pt: planta.recorte_pt,
    largura: planta.largura,
    altura: planta.altura,
  }
  const pontos = pagina.map(([x, y]): Ponto2 => {
    const p = marcadorParaPixel({ x, y }, ref)
    return [p.x, p.y]
  })
  const xs = [0, planta.largura, ...pontos.map((p) => p[0])]
  const ys = [0, planta.altura, ...pontos.map((p) => p[1])]
  const maior = Math.max(planta.largura, planta.altura)
  const margem = maior * 0.05
  const x0 = Math.min(...xs) - margem
  const y0 = Math.min(...ys) - margem
  const l = Math.max(...xs) + margem - x0
  const a = Math.max(...ys) + margem - y0
  return {
    pontos,
    viewBox: `${x0} ${y0} ${l} ${a}`,
    raio: Math.max(l, a) * 0.035,
  }
}

/**
 * Planta do ambiente com os cantos numerados. Com o recorte da planta e `contornoPagina`, mostra o
 * cômodo na planta real; senão, a planta esquemática vista de cima. `miniatura` é só leitura.
 */
function PlantaDosCantos({
  geometria,
  planta,
  bloqueado,
  onEscolher,
  miniatura = false,
}: {
  geometria: GeometriaAmbiente
  planta?: PlantaRA | null
  bloqueado: number | null
  onEscolher?: (indice: number) => void
  miniatura?: boolean
}) {
  const real = plantaReal(geometria, planta)
  let pontos: Ponto2[]
  let viewBox: string
  let raio: number
  if (real) {
    ;({ pontos, viewBox, raio } = real)
  } else {
    const xs = geometria.contorno.map((p) => p[0])
    const zs = geometria.contorno.map((p) => p[1])
    const x0 = Math.min(...xs)
    const z0 = Math.min(...zs)
    const largura = Math.max(...xs) - x0
    const altura = Math.max(...zs) - z0
    const escala = 240 / Math.max(largura, altura, 0.1)
    const margem = 28
    pontos = geometria.contorno.map(([x, z]): Ponto2 => [margem + (x - x0) * escala, margem + (z - z0) * escala])
    viewBox = `0 0 ${largura * escala + margem * 2} ${altura * escala + margem * 2}`
    raio = 18
  }
  const legivel = miniatura ? 'Planta do cômodo' : 'Cantos do ambiente'
  return (
    <svg
      className={miniatura ? 'ra-planta ra-planta-mini' : 'ra-planta'}
      viewBox={viewBox}
      role={miniatura ? 'img' : 'group'}
      aria-label={legivel}
      data-testid={miniatura ? 'ra-miniatura' : undefined}
    >
      {real && planta?.url && <image href={planta.url} x={0} y={0} width={planta.largura} height={planta.altura} />}
      <polygon className={real ? 'ra-planta-comodo' : undefined} points={pontos.map((p) => p.join(',')).join(' ')} />
      {pontos.map(([x, y], i) => {
        const marcado = bloqueado === i
        const ativo = !miniatura && !marcado
        const classe = ['ra-canto', marcado && 'ra-canto-bloqueado', marcado && real && 'ra-canto-marcado']
          .filter(Boolean)
          .join(' ')
        const rotulo = marcado ? '✓' : String(i + 1)
        if (miniatura) {
          return (
            <g key={i} className={classe}>
              <circle cx={x} cy={y} r={raio} />
              <text x={x} y={y} dy="0.35em" textAnchor="middle" style={{ fontSize: raio * 1.1 }}>
                {rotulo}
              </text>
            </g>
          )
        }
        return (
          <g
            key={i}
            role="button"
            tabIndex={ativo ? 0 : -1}
            aria-label={`Canto ${i + 1}`}
            aria-disabled={marcado}
            className={classe}
            onClick={() => ativo && onEscolher?.(i)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && ativo) onEscolher?.(i)
            }}
          >
            <circle cx={x} cy={y} r={raio} />
            <text x={x} y={y} dy="0.35em" textAnchor="middle" style={{ fontSize: raio * 1.1 }}>
              {rotulo}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
