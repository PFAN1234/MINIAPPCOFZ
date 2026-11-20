import type { AmbienteRA, QrAmbiente } from '../../../../admin/dados/tipos.ts'
import type { GeometriaAmbiente } from '../../../../ra/geometria.ts'

/** Porta de dados da realidade aumentada (geometria dos ambientes e QR). */
export interface RaRepositorio {
  /** Geometria do ambiente para a RA (contorno, piso, forro, QR, referencial); null se não houver. */
  obterGeometria(obra: { id: string; slug: string }, ambiente: { id: string; codigo: string }): Promise<GeometriaAmbiente | null>
  /** Ambientes da obra com geometria e seu QR (admin). */
  listarRA(obraId: string): Promise<AmbienteRA[]>
  /** Grava o QR do ambiente (distâncias em metros); rejeita posição inválida. */
  definirQr(ambienteId: string, qr: QrAmbiente): Promise<void>
  /** Remove o QR do ambiente. */
  removerQr(ambienteId: string): Promise<void>
}
