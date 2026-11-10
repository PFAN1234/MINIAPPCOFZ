import { useRef, type ChangeEvent } from 'react'

export const MAX_FOTOS = 10

export interface ItemFoto {
  /** Chave local estável (não é o id da foto no servidor). */
  chave: string
  previa: string | null
  estado: 'preparando' | 'pronta' | 'erro'
  mensagem?: string
}

/** Botões Câmera/Galeria e grade de miniaturas com remover; a compressão fica por conta de quem usa. */
export function SeletorFotos({
  itens,
  desabilitado,
  onAdicionar,
  onRemover,
}: {
  itens: ItemFoto[]
  desabilitado: boolean
  onAdicionar: (arquivos: File[]) => void
  onRemover: (chave: string) => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const galeria = useRef<HTMLInputElement>(null)
  const cheio = itens.length >= MAX_FOTOS

  function escolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (arquivos.length > 0) onAdicionar(arquivos)
  }

  return (
    <div className="seletor-fotos">
      <p className="campo-rotulo" id="rotulo-fotos">
        Fotos <span className="campo-dica">({itens.length} de {MAX_FOTOS})</span>
      </p>
      {itens.length > 0 && (
        <ul className="fotos-grade" aria-labelledby="rotulo-fotos">
          {itens.map((item, i) => (
            <li key={item.chave} className={`foto-item foto-${item.estado}`}>
              {item.previa && <img src={item.previa} alt={`Foto ${i + 1}`} />}
              {item.estado === 'preparando' && (
                <span className="foto-status" role="status">
                  Preparando…
                </span>
              )}
              {item.estado === 'erro' && (
                <span className="foto-status foto-status-erro" role="alert">
                  {item.mensagem ?? 'Não foi possível ler esta foto.'}
                </span>
              )}
              <button
                type="button"
                className="foto-remover"
                aria-label={`Remover foto ${i + 1}`}
                disabled={desabilitado}
                onClick={() => onRemover(item.chave)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fotos-acoes">
        <button
          type="button"
          className="botao botao-secundario"
          disabled={desabilitado || cheio}
          onClick={() => camera.current?.click()}
        >
          Câmera
        </button>
        <button
          type="button"
          className="botao botao-secundario"
          disabled={desabilitado || cheio}
          onClick={() => galeria.current?.click()}
        >
          Galeria
        </button>
      </div>
      {cheio && <p className="campo-dica">Limite de {MAX_FOTOS} fotos atingido.</p>}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Tirar foto com a câmera"
        onChange={escolher}
      />
      <input
        ref={galeria}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Escolher fotos da galeria"
        onChange={escolher}
      />
    </div>
  )
}
