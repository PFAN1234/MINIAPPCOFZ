import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { TopoTela } from '@shared/ui/layout/TopoTela.tsx'
import { abrirCamera, fecharCamera } from '@modules/ra/infra/browser/camera.ts'
import { criarLeitorQr } from '@modules/ra/infra/browser/leitorQr.ts'
import { iniciarOrientacao, type Orientacao } from '@modules/ra/infra/three/orientacao.ts'
import './ra.css'

interface Medidas {
  camera: string
  sensor: string
  leiturasPorSegundo: string
  deriva: string
  webgl: string
  detectorQr: string
  qr: string
  telegram: string
}

const VAZIO: Medidas = {
  camera: '—',
  sensor: '—',
  leiturasPorSegundo: '—',
  deriva: '—',
  webgl: '—',
  detectorQr: '—',
  qr: 'aponte para um QR',
  telegram: '—',
}

const ROTULOS: [keyof Medidas, string][] = [
  ['camera', 'Câmera traseira'],
  ['sensor', 'Sensor de orientação'],
  ['leiturasPorSegundo', 'Leituras por segundo'],
  ['deriva', 'Giro desde o início'],
  ['webgl', 'WebGL 2'],
  ['detectorQr', 'Leitor de QR'],
  ['qr', 'QR lido'],
  ['telegram', 'Telegram'],
]

/**
 * Prova no aparelho (RA0): mostra se a câmera ao vivo, os sensores, o WebGL e a leitura de
 * QR funcionam neste aparelho, dentro do Telegram. Deixe o celular parado sobre a mesa por
 * um minuto para ver a deriva do giroscópio.
 */
export default function DiagnosticoRA() {
  const video = useRef<HTMLVideoElement>(null)
  const desmontado = useRef(false)
  const fluxoRef = useRef<MediaStream | null>(null)
  const orientacaoRef = useRef<Orientacao | null>(null)
  const temporizadoresRef = useRef<ReturnType<typeof setInterval>[]>([])
  const [iniciado, setIniciado] = useState(false)
  const [m, setM] = useState<Medidas>(VAZIO)

  useEffect(
    () => () => {
      desmontado.current = true
      for (const t of temporizadoresRef.current) clearInterval(t)
      temporizadoresRef.current = []
      fecharCamera(fluxoRef.current)
      fluxoRef.current = null
      orientacaoRef.current?.parar()
      orientacaoRef.current = null
    },
    [],
  )

  async function iniciar() {
    if (iniciado) return
    setIniciado(true)
    const definir = (parte: Partial<Medidas>) => !desmontado.current && setM((atual) => ({ ...atual, ...parte }))

    const app = window.Telegram?.WebApp
    definir({
      telegram: app?.initData ? `Bot API ${app.version ?? '?'}` : 'fora do Telegram',
      webgl: document.createElement('canvas').getContext('webgl2') ? 'disponível' : 'indisponível',
      detectorQr: 'BarcodeDetector' in globalThis ? 'nativo do navegador' : 'jsQR (biblioteca)',
    })

    // No iOS, o pedido de permissão precisa partir diretamente do gesto do clique.
    const promessaOrientacao = iniciarOrientacao()
    const promessaCamera = video.current ? abrirCamera(video.current) : null
    void (async () => {
      try {
        const o = await promessaOrientacao
        if (desmontado.current) {
          o.parar()
          return
        }
        orientacaoRef.current = o
        const frenteInicial = new Vector3(0, 0, -1)
        let referencia: Vector3 | null = null
        let anteriores = 0
        temporizadoresRef.current.push(
          setInterval(() => {
            const n = o.leituras()
            if (n > 0 && !referencia) referencia = frenteInicial.clone().applyQuaternion(o.atual())
            const agora = new Vector3(0, 0, -1).applyQuaternion(o.atual())
            definir({
              sensor:
                o.fonte() === 'nenhuma'
                  ? 'sem leitura'
                  : o.fonte() === 'telegram'
                    ? 'API do Telegram'
                    : 'evento do navegador',
              leiturasPorSegundo: String(n - anteriores),
              deriva: referencia ? `${((agora.angleTo(referencia) * 180) / Math.PI).toFixed(1)}°` : '—',
            })
            anteriores = n
          }, 1000),
        )
      } catch {
        definir({ sensor: 'falhou ao iniciar' })
      }
    })()
    void (async () => {
      try {
        if (!promessaCamera) return
        const f = await promessaCamera
        if (desmontado.current) {
          fecharCamera(f)
          return
        }
        fluxoRef.current = f
        const faixa = f.getVideoTracks()[0]
        const s = faixa?.getSettings() ?? {}
        definir({ camera: `${s.width ?? '?'}×${s.height ?? '?'} a ${Math.round(s.frameRate ?? 0)} qps` })
        const leitor = await criarLeitorQr()
        if (desmontado.current) return
        let lendo = false
        temporizadoresRef.current.push(
          setInterval(() => {
            const v = video.current
            if (!v || lendo || desmontado.current) return
            lendo = true
            void leitor
              .ler(v, v.clientWidth / Math.max(1, v.clientHeight))
              .then((lido) => {
                if (!lido || desmontado.current) return
                const [a, b] = lido.cantos
                const lado = Math.hypot(a[0] - b[0], a[1] - b[1]) / 2
                definir({ qr: `${lido.texto.slice(0, 60)} (ocupa ${Math.round(lado * 100)}% da largura)` })
              })
              .finally(() => {
                lendo = false
              })
          }, 500),
        )
      } catch (e) {
        definir({ camera: e instanceof Error ? e.message : 'falhou' })
      }
    })()
  }

  return (
    <section aria-labelledby="titulo-diagnostico">
      <TopoTela titulo="Teste da realidade aumentada" idTitulo="titulo-diagnostico" />
      <p className="campo-dica">
        Confere se este aparelho abre a câmera, lê os sensores e desenha o modelo dentro do app. Envie uma captura
        desta tela para quem está configurando a obra.
      </p>
      {!iniciado && (
        <button type="button" className="botao botao-bloco" onClick={() => void iniciar()}>
          Iniciar teste
        </button>
      )}
      <video ref={video} className="ra-diagnostico-video" autoPlay muted playsInline hidden={!iniciado} />
      {iniciado && (
        <dl className="ra-diagnostico">
          {ROTULOS.map(([chave, rotulo]) => (
            <div key={chave}>
              <dt>{rotulo}</dt>
              <dd>{m[chave]}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
