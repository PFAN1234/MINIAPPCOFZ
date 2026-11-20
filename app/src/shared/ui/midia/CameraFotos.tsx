import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { abrirCamera, capturarQuadro, fecharCamera } from '@modules/ra/infra/browser/camera.ts'

/** Câmera em tela cheia para o Telegram Android, que ignora `capture` no input de arquivo. */
export function CameraFotos({
  jaEscolhidas,
  limite,
  onFoto,
  onFechar,
  onUsarGaleria,
}: {
  jaEscolhidas: number
  limite: number
  onFoto: (arquivo: File) => void
  onFechar: () => void
  onUsarGaleria: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const fluxo = useRef<MediaStream | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tiradas, setTiradas] = useState(0)
  const [flash, setFlash] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const total = jaEscolhidas + tiradas

  useEffect(() => {
    let ativo = true
    const el = video.current
    if (!el) return undefined
    abrirCamera(el).then(
      (f) => {
        if (ativo) fluxo.current = f
        else fecharCamera(f)
      },
      (e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível abrir a câmera.')
      },
    )
    return () => {
      ativo = false
      fecharCamera(fluxo.current)
      fluxo.current = null
    }
  }, [])

  async function disparar() {
    const el = video.current
    if (!el || ocupado || total >= limite) return
    setOcupado(true)
    try {
      const blob = await capturarQuadro(el)
      onFoto(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      setTiradas((n) => n + 1)
      setFlash(true)
      setTimeout(() => setFlash(false), 150)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gerar a foto.')
    } finally {
      setOcupado(false)
    }
  }

  function concluir() {
    fecharCamera(fluxo.current)
    fluxo.current = null
    onFechar()
  }

  return createPortal(
    <div className="camera-fotos" role="dialog" aria-modal="true" aria-label="Câmera">
      {erro ? (
        <div className="camera-fotos-erro">
          <p role="alert">{erro}</p>
          <button type="button" className="botao botao-secundario" onClick={onUsarGaleria}>
            Usar galeria
          </button>
          <button type="button" className="botao botao-secundario" onClick={concluir}>
            Fechar
          </button>
        </div>
      ) : (
        <>
          <video ref={video} className="camera-fotos-video" autoPlay playsInline muted />
          {flash && <div className="camera-fotos-flash" data-testid="camera-flash" />}
          <div className="camera-fotos-barra">
            <span className="camera-fotos-contador">
              {total} de {limite}
            </span>
            <button
              type="button"
              className="camera-fotos-disparo"
              aria-label="Tirar foto"
              disabled={total >= limite || ocupado}
              onClick={disparar}
            />
            <button type="button" className="camera-fotos-concluir" onClick={concluir}>
              Concluir
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
