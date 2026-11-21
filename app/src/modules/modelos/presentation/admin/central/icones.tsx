/** Ícones da central de modelos em SVG inline (sem dependência). Traço único, herdam `currentColor`. */
import type { ReactNode } from 'react'

interface Props {
  tamanho?: number
}

function Icone({ children, tamanho = 18 }: { children: ReactNode; tamanho?: number }) {
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

// Barra superior

export const IconeEnquadrar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4" />
  </Icone>
)

export const IconeProjecao = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 8.5 9 6h11v10l-5 2.5H4v-10Z" />
    <path d="M4 8.5h11v10M15 8.5 20 6" />
  </Icone>
)

export const IconeCor = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M12 3.5s6 6 6 10.5a6 6 0 0 1-12 0c0-4.5 6-10.5 6-10.5Z" />
    <path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" />
  </Icone>
)

export const IconeGrade = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
  </Icone>
)

export const IconeVista3d = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" />
  </Icone>
)

export const IconePlanta = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M4 11h7M11 4v10M11 17v3M15 11h5M15 11v4" />
  </Icone>
)

export const IconeCortar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M12 3 19 7v10l-7 4-7-4V7l7-4Z" />
    <path d="M3 15 21 9" strokeDasharray="3 2" />
  </Icone>
)

export const IconeMinimapa = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z" />
    <path d="M9 4v14M15 6v14" />
  </Icone>
)

export const IconeMedir = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="m4 16 12-12 4 4L8 20l-4-4Z" />
    <path d="m8 12 2 2M11 9l2 2M14 6l2 2" />
  </Icone>
)

export const IconeModelos = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
    <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
  </Icone>
)

export const IconeIssues = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M6 21V4" />
    <path d="M6 4h12l-2.5 4 2.5 4H6" />
  </Icone>
)

export const IconeCaptura = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 8h3l1.5-2.5h7L17 8h3v11H4V8Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icone>
)

export const IconeObra = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M5 21V4h9v17M14 10h5v11M3 21h18" />
    <path d="M8.5 8h2M8.5 12h2M8.5 16h2M16 14h1M16 17h1" />
  </Icone>
)

// Submenu Medir

export const IconeDistancia = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M5 19 19 5M3.5 16.5l4 4M16.5 3.5l4 4" />
  </Icone>
)

export const IconeArea = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="m5 8 8-4 6 6-3 9-11-1V8Z" />
  </Icone>
)

export const IconeVolume = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 8 8 5h12v11l-4 3H4V8Z" />
    <path d="M4 8h12v11M16 8l4-3" />
  </Icone>
)

export const IconeAngulo = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 19h15M4 19 15 6" />
    <path d="M10 19a6 6 0 0 0-1.5-4" />
  </Icone>
)

// Trilho

export const IconeItens = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 5h5M8 12h5M8 19h5M6 5v14M6 12h2M6 19h2" />
    <path d="M16 5h4M16 12h4M16 19h4" />
  </Icone>
)

export const IconeDocumentos = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M7 3h7l5 5v13H7V3Z" />
    <path d="M14 3v5h5M10 13h6M10 17h6" />
  </Icone>
)

export const IconeGestao = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icone>
)

export const IconeSol = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </Icone>
)

export const IconeLua = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
  </Icone>
)

export const IconeRealce = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="m6 6 5 13 2-5.5L18.5 11 6 6Z" />
    <path d="M16 4v2M19.5 5.5 18 7M20 9h-2" />
  </Icone>
)

/** Painel lateral com chevron: aberto aponta para a esquerda (recolher), fechado para a direita (abrir). */
export const IconePainel = ({ tamanho, aberto }: Props & { aberto: boolean }) => (
  <Icone tamanho={tamanho}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d={aberto ? 'm17 9-3 3 3 3' : 'm14 9 3 3-3 3'} />
  </Icone>
)

// Barra de visibilidade

export const IconeOlho = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.5" />
  </Icone>
)

export const IconeOcultar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="m4 4 16 16" />
  </Icone>
)

export const IconeIsolar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="1.5" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Icone>
)

export const IconeFantasma = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" strokeDasharray="3 2.5" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" strokeDasharray="3 2.5" />
  </Icone>
)

export const IconeCaminhar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <circle cx="13" cy="4.5" r="1.8" />
    <path d="m10 21 2-6-2.5-2.5 1-5 3.5 1.5 2 3M9.5 12.5 7 14M15 15l2 6M11.5 7.5 9 9" />
  </Icone>
)

export const IconeLimpar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icone>
)

// Modo

export const IconeVer = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="m6 5 4.5 13 2-5.5L18 10.5 6 5Z" />
    <path d="m13 13 5 5" />
  </Icone>
)

export const IconeInspecionar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5M10.5 9.5v4M10.5 7.5v.01" />
  </Icone>
)
export const IconeHistorico = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </Icone>
)
export const IconeRetirar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
    <path d="M10 13h4" />
  </Icone>
)
export const IconeVinculos = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
  </Icone>
)
export const IconeRemoverVinculo = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icone>
)
export const IconeBaixar = ({ tamanho }: Props) => (
  <Icone tamanho={tamanho}>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 20h14" />
  </Icone>
)
