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

// Ícones do novo visual (direção B · Canteiro), usados pelas telas a partir da V1.

export function IconeCasa({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </Icone>
  )
}

export function IconeLista({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </Icone>
  )
}

export function IconeAlerta({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </Icone>
  )
}

export function IconeCamera({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </Icone>
  )
}

export function IconeGaleria({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15.5-5-5L6.5 20" />
    </Icone>
  )
}

export function IconeMais({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M12 5v14M5 12h14" />
    </Icone>
  )
}

export function IconeLupa({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </Icone>
  )
}

/** Planta: mapa dobrado. */
export function IconePlanta({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </Icone>
  )
}

export function IconeCelular({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </Icone>
  )
}

export function IconeSemSinal({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M2.5 8.8a14 14 0 0 1 19 0" />
      <path d="M5.8 12.2a9.5 9.5 0 0 1 12.4 0" />
      <path d="M9 15.6a5 5 0 0 1 6 0" />
      <path d="M12 19h.01" />
      <path d="m4 4 16 16" />
    </Icone>
  )
}

export function IconeCheck({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icone>
  )
}

export function IconeFechar({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icone>
  )
}

export function IconeVoltar({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Icone>
  )
}

export function IconePessoas({ tamanho }: { tamanho?: number }) {
  return (
    <Icone tamanho={tamanho}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.2 14.3c2.3.6 3.8 2.5 3.8 5.2" />
    </Icone>
  )
}
