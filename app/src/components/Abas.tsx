import { useRef, type KeyboardEvent } from 'react'

export interface ItemAba {
  id: string
  rotulo: string
}

/** Abas acessíveis (role=tablist), com setas do teclado. O conteúdo fica por conta de quem usa. */
export function Abas({
  rotulo,
  itens,
  ativa,
  onMudar,
}: {
  rotulo: string
  itens: ItemAba[]
  ativa: string
  onMudar: (id: string) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function teclado(e: KeyboardEvent, i: number) {
    let alvo = -1
    if (e.key === 'ArrowRight') alvo = (i + 1) % itens.length
    else if (e.key === 'ArrowLeft') alvo = (i - 1 + itens.length) % itens.length
    if (alvo < 0) return
    e.preventDefault()
    onMudar(itens[alvo].id)
    refs.current[alvo]?.focus()
  }

  return (
    <div className="abas" role="tablist" aria-label={rotulo}>
      {itens.map((item, i) => {
        const selecionada = item.id === ativa
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selecionada}
            tabIndex={selecionada ? 0 : -1}
            className="aba"
            onClick={() => onMudar(item.id)}
            onKeyDown={(e) => teclado(e, i)}
          >
            {item.rotulo}
          </button>
        )
      })}
    </div>
  )
}
