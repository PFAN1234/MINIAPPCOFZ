import geometriaJson from '../../../../../data/hto/geometria.json'
import type { AmbienteRA } from '../../../admin/dados/tipos.ts'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { RaRepositorio } from '../application/ports/RaRepositorio.port.ts'
import type { QrAmbiente } from '../domain/tipos.ts'

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Geometria de teste (HTO): um retângulo de 6,03 × 3,96 m e um ambiente em L, o primeiro com QR. */
function geometriaHto(): AmbienteRA[] {
  return [
    {
      ambiente_id: 'terreo-administracao',
      codigo: 'terreo-administracao',
      nome: 'Administração',
      pavimento: 'Térreo',
      contorno: [
        [0, 0],
        [6.03, 0],
        [6.03, 3.96],
        [0, 3.96],
      ],
      y_piso: -0.805,
      y_teto: 1.795,
      qr: { parede: 0, distancia_m: 2.5, altura_m: 1.5, lado_m: 0.18 },
      contorno_pagina: [
        [0.3, 0.3],
        [0.6, 0.3],
        [0.6, 0.6],
        [0.3, 0.6],
      ],
      planta: {
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Crect width='800' height='400' fill='%23eee'/%3E%3C/svg%3E",
        pagina_pt: [1000, 500],
        recorte_pt: [100, 50, 900, 450],
        largura: 800,
        altura: 400,
      },
    },
    {
      ambiente_id: 'terreo-alojamento',
      codigo: 'terreo-alojamento',
      nome: 'Alojamento',
      pavimento: 'Térreo',
      contorno: [
        [0, 0],
        [5, 0],
        [5, 2],
        [3, 2],
        [3, 4],
        [0, 4],
      ],
      y_piso: -0.805,
      y_teto: 1.795,
      qr: null,
      contorno_pagina: null,
      planta: null,
    },
  ]
}

/**
 * Adaptador em memória da RA (cada chamada começa com estado novo). `exigirAdmin` é opcional:
 * a fixture do admin passa o seu para manter a checagem de sessão nas operações administrativas.
 */
export function criarRaFixture(opcoes: { exigirAdmin?: () => void } = {}): RaRepositorio {
  const exigirAdmin = opcoes.exigirAdmin ?? (() => {})
  const geometriaPorObra = new Map<string, AmbienteRA[]>([['obra-hto', geometriaHto()]])
  return {
    async obterGeometria(obra, ambiente) {
      if (obra.slug !== geometriaJson.obra) return null
      const g = (geometriaJson.ambientes as Record<string, { contorno: number[][]; contorno_pagina?: number[][]; y_piso: number; y_teto: number }>)[
        ambiente.codigo
      ]
      if (!g) return null
      return {
        contorno: g.contorno.map(([x, z]) => [x, z]),
        ...(g.contorno_pagina ? { contornoPagina: g.contorno_pagina.map(([x, y]) => [x, y] as [number, number]) } : {}),
        yPiso: g.y_piso,
        yTeto: g.y_teto,
        // QR de teste só no Apto. 101: parede 1, a 1,20 m do canto, centro a 1,50 m.
        qr: ambiente.codigo === 'terreo-apto-101' ? { parede: 0, distancia_m: 1.2, altura_m: 1.5, lado_m: 0.18 } : null,
        referencial: { sigla: geometriaJson.referencial.sigla, coordenadas: geometriaJson.referencial.coordenadas },
        matrizes: {},
      }
    },

    async listarRA(obraId) {
      exigirAdmin()
      return copia(geometriaPorObra.get(obraId) ?? [])
    },

    async definirQr(ambienteId, qr: QrAmbiente) {
      exigirAdmin()
      const a = [...geometriaPorObra.values()].flat().find((x) => x.ambiente_id === ambienteId)
      if (!a) throw new ErroAdmin('Ambiente sem geometria.')
      const n = a.contorno.length
      if (!Number.isInteger(qr.parede) || qr.parede < 0 || qr.parede >= n) {
        throw new ErroAdmin(`Parede inválida: use de 1 a ${n}.`)
      }
      const [x0, z0] = a.contorno[qr.parede]
      const [x1, z1] = a.contorno[(qr.parede + 1) % n]
      const comprimento = Math.hypot(x1 - x0, z1 - z0)
      if (!(qr.distancia_m >= 0 && qr.distancia_m <= comprimento)) {
        throw new ErroAdmin('A distância precisa estar entre 0 e o comprimento da parede.')
      }
      if (!(qr.altura_m >= 0 && qr.altura_m <= 5)) throw new ErroAdmin('A altura precisa estar entre 0 e 5 m.')
      if (!(qr.lado_m >= 0.05 && qr.lado_m <= 1)) throw new ErroAdmin('O lado precisa estar entre 5 e 100 cm.')
      a.qr = { ...qr }
    },

    async removerQr(ambienteId) {
      exigirAdmin()
      const a = [...geometriaPorObra.values()].flat().find((x) => x.ambiente_id === ambienteId)
      if (!a) throw new ErroAdmin('Ambiente sem geometria.')
      a.qr = null
    },
  }
}
