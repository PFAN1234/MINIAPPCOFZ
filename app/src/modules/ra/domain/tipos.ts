/** Tipos da RA usados fora do módulo carregado sob demanda (sem dependência do Three.js). */

export type OrigemFoto = 'normal' | 'ra_limpa' | 'ra_modelo'

/** Conteúdo de `foto.ra` (ver `docs/contrato-ra.md`). */
export interface DadosRA {
  /** Id da outra foto do par (omitido se o par foi desfeito antes do envio). */
  par?: string
  modelos: { sigla: string; revisao: string | null; hash: string }[]
  alinhamento: 'cantos' | 'qr'
  pose: { posicao: [number, number, number]; rumo: number; fov: number }
  /** Só quando o fiscal conferiu um terceiro canto. */
  erro_cm?: number
}

/** Foto tirada na RA, pronta para entrar no registro. */
export interface FotoRA {
  id: string
  arquivo: File
  origem: Exclude<OrigemFoto, 'normal'>
  ra: DadosRA
}

/** Ponto `[x, z]` (metros) ou `[x, y]` (página 0..1), conforme o contexto. */
export type Ponto2 = [number, number]

/** Posição do QR de um ambiente (tabela `ambiente_qr`; ver docs/contrato-ra.md). */
export interface QrAmbiente {
  /** Aresta do contorno: do canto `parede` ao canto seguinte. */
  parede: number
  /** Do canto inicial da parede até o centro do QR (m). */
  distancia_m: number
  /** Centro do QR acima do piso acabado (m). */
  altura_m: number
  /** Lado do quadrado do QR (m). */
  lado_m: number
}

export interface GeometriaAmbiente {
  /** `[x, z]` de cada canto, sem repetir o primeiro. */
  contorno: Ponto2[]
  /**
   * Os mesmos cantos de `contorno`, na mesma ordem, na página da planta do pavimento
   * (`[x, y]` de 0 a 1, como os marcadores). Ausente quando não há calibração da planta.
   */
  contornoPagina?: Ponto2[]
  yPiso: number
  yTeto: number
  qr: QrAmbiente | null
  /** `getCoordinates()` do `.frag` de referência (ARQ) e sua sigla; null se não houver. */
  referencial: { sigla: string; coordenadas: number[] } | null
  /** Correção opcional por modelo (16 números de `Matrix4.elements`), por sigla. */
  matrizes: Record<string, number[]>
}
