/** Tipos da RA usados fora do módulo carregado sob demanda (sem dependência do Three.js). */

export type OrigemFoto = 'normal' | 'ra_limpa' | 'ra_modelo'

/** Conteúdo de `foto.ra` (ver `docs/contrato-ra.md`). */
export interface DadosRA {
  /** Id da outra foto do par. */
  par: string
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
