import type { FabricaMotor } from '@modules/modelos/application/ports/MotorVisualizador.port.ts'

/**
 * Composition root do motor 3D da central: o adaptador That Open (three, camera-controls,
 * worker) só é baixado quando a rota `/modelos/:slug` abre, mantendo-o fora do chunk do admin.
 */
export const fabricaMotor: FabricaMotor = async () => {
  const { criarMotorThatOpen } = await import('@modules/modelos/infra/thatopen/motor.ts')
  return criarMotorThatOpen()
}
