/** Porta da câmera do aparelho. */
export interface Camera {
  /** Abre a câmera traseira no vídeo e devolve o fluxo. */
  abrir(video: HTMLVideoElement): Promise<MediaStream>
  /** Para as trilhas do fluxo (aceita null). */
  fechar(fluxo: MediaStream | null): void
}
