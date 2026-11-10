/** Ícones em SVG inline (sem dependência). Herdam a cor do texto (`currentColor`). */
import type { ReactNode } from 'react'

function Icone({ children, tamanho = 24 }: { children: ReactNode; tamanho?: number }) {
  return (
    <svg
      className="icone"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function IconeCubo({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </Icone>
  )
}

export function IconeChevron({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="m9 6 6 6-6 6" />
    </Icone>
  )
}

export function IconeFiltro({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z" />
    </Icone>
  )
}

export function IconeUsuario({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </Icone>
  )
}

export function IconePredio({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    </Icone>
  )
}
