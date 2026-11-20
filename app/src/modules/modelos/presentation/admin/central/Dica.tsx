import { useEffect, useState, type RefObject } from 'react'

/** Lado preferido da dica em relação ao botão (`data-dica-lado`); o padrão é embaixo. */
type Lado = 'baixo' | 'cima' | 'direita'

interface Aberta {
  texto: string
  x: number
  y: number
  lado: Lado
  /** Perto da borda da janela a dica alinha pela ponta do botão, em vez do centro. */
  alinha: 'centro' | 'inicio' | 'fim'
}

const ATRASO_MS = 350
const ESPACO = 8
/** Distância da borda da janela abaixo da qual a dica deixa de centralizar. */
const MARGEM = 140

function posicao(el: HTMLElement): Aberta {
  const r = el.getBoundingClientRect()
  const lado = (el.dataset.dicaLado as Lado | undefined) ?? 'baixo'
  const texto = el.dataset.dica ?? ''
  if (lado === 'direita') return { texto, lado, alinha: 'centro', x: r.right + ESPACO, y: r.top + r.height / 2 }
  const largura = window.innerWidth
  const alinha = r.right > largura - MARGEM ? 'fim' : r.left < MARGEM ? 'inicio' : 'centro'
  const x = alinha === 'fim' ? r.right : alinha === 'inicio' ? r.left : r.left + r.width / 2
  return { texto, lado, alinha, x, y: lado === 'cima' ? r.top - ESPACO : r.bottom + ESPACO }
}

function focoVisivel(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

function alvo(e: Event): HTMLElement | null {
  const t = e.target
  return t instanceof Element ? (t.closest('[data-dica]') as HTMLElement | null) : null
}

/**
 * Dica flutuante dos botões de ferramenta da central: o nome aparece só ao passar o mouse
 * (com atraso curto) ou ao focar pelo teclado. Lê `data-dica` (e `data-dica-lado`) de qualquer
 * elemento dentro da raiz; fica em posição fixa, fora das barras que rolam, para não ser cortada.
 * O botão já tem `aria-label`: a dica é só visual.
 */
export default function Dicas({ raiz }: { raiz: RefObject<HTMLElement | null> }) {
  const [aberta, setAberta] = useState<Aberta | null>(null)

  useEffect(() => {
    const el = raiz.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let atual: HTMLElement | null = null
    let visivel = false
    const mostrar = (a: HTMLElement) => {
      visivel = true
      setAberta(posicao(a))
    }
    const fechar = () => {
      clearTimeout(timer)
      atual = null
      visivel = false
      setAberta(null)
    }
    const sobre = (e: PointerEvent) => {
      const a = alvo(e)
      if (a === atual) return
      clearTimeout(timer)
      atual = a
      if (!a) {
        visivel = false
        setAberta(null)
        return
      }
      // Passando de um botão a outro com a dica já aberta: troca na hora.
      if (visivel) mostrar(a)
      else {
        setAberta(null)
        timer = setTimeout(() => atual === a && mostrar(a), ATRASO_MS)
      }
    }
    const fora = (e: PointerEvent) => {
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) fechar()
    }
    const foco = (e: FocusEvent) => {
      const a = alvo(e)
      if (a && focoVisivel(a)) {
        atual = a
        mostrar(a)
      }
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && fechar()
    el.addEventListener('pointerover', sobre)
    el.addEventListener('pointerout', fora)
    el.addEventListener('pointerdown', fechar)
    el.addEventListener('focusin', foco)
    el.addEventListener('focusout', fechar)
    el.addEventListener('keydown', tecla)
    window.addEventListener('scroll', fechar, true)
    window.addEventListener('resize', fechar)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('pointerover', sobre)
      el.removeEventListener('pointerout', fora)
      el.removeEventListener('pointerdown', fechar)
      el.removeEventListener('focusin', foco)
      el.removeEventListener('focusout', fechar)
      el.removeEventListener('keydown', tecla)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
  }, [raiz])

  if (!aberta || !aberta.texto) return null
  return (
    <div
      className="central-dica"
      data-lado={aberta.lado}
      data-alinha={aberta.alinha}
      aria-hidden="true"
      style={{ left: aberta.x, top: aberta.y }}
    >
      {aberta.texto}
    </div>
  )
}
