import type { QrLido } from '../../../../ra/leitorQr.ts'

/** Porta de leitura de QR no vídeo. */
export interface LeitorQr {
  /** Lê o quadro atual (a parte visível do vídeo); null se não houver QR. */
  ler(video: HTMLVideoElement, aspectoTela: number): Promise<QrLido | null>
}
