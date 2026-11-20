import { describe, expect, it } from 'vitest'
import { ErroAdmin } from '../../../../admin/dados/tipos.ts'
import type { RaRepositorio } from './RaRepositorio.port.ts'

const OBRA = { id: 'obra-hto', slug: 'hto' }
const QR_OK = { parede: 0, distancia_m: 0.5, altura_m: 1.5, lado_m: 0.2 }

/** Comportamento que toda implementação de `RaRepositorio` deve cumprir. */
export function contratoRaRepositorio(nome: string, criar: () => RaRepositorio) {
  describe(`RaRepositorio (${nome})`, () => {
    async function primeiro(repo: RaRepositorio) {
      const lista = await repo.listarRA(OBRA.id)
      return { lista, a: lista[0] }
    }
    const comprimento = (c: [number, number][], i: number) => {
      const [x0, z0] = c[i]
      const [x1, z1] = c[(i + 1) % c.length]
      return Math.hypot(x1 - x0, z1 - z0)
    }

    it('listarRA devolve ambientes com contorno', async () => {
      const { lista } = await primeiro(criar())
      expect(lista.length).toBeGreaterThan(0)
      for (const a of lista) expect(a.contorno.length).toBeGreaterThanOrEqual(3)
    })

    it('definirQr válido persiste e aparece em listarRA', async () => {
      const repo = criar()
      const { a } = await primeiro(repo)
      await repo.definirQr(a.ambiente_id, QR_OK)
      const depois = (await repo.listarRA(OBRA.id)).find((x) => x.ambiente_id === a.ambiente_id)
      expect(depois?.qr).toEqual(QR_OK)
    })

    it('definirQr rejeita parede, distância, altura e lado inválidos', async () => {
      const repo = criar()
      const { a } = await primeiro(repo)
      const invalidos = [
        { ...QR_OK, parede: a.contorno.length },
        { ...QR_OK, parede: -1 },
        { ...QR_OK, distancia_m: -0.1 },
        { ...QR_OK, distancia_m: comprimento(a.contorno, 0) + 0.01 },
        { ...QR_OK, altura_m: -0.1 },
        { ...QR_OK, altura_m: 5.1 },
        { ...QR_OK, lado_m: 0.04 },
        { ...QR_OK, lado_m: 1.01 },
      ]
      for (const qr of invalidos) await expect(repo.definirQr(a.ambiente_id, qr)).rejects.toBeInstanceOf(ErroAdmin)
    })

    it('removerQr zera o QR', async () => {
      const repo = criar()
      const { a } = await primeiro(repo)
      await repo.definirQr(a.ambiente_id, QR_OK)
      await repo.removerQr(a.ambiente_id)
      const depois = (await repo.listarRA(OBRA.id)).find((x) => x.ambiente_id === a.ambiente_id)
      expect(depois?.qr).toBeNull()
    })

    it('ambiente inexistente rejeita', async () => {
      const repo = criar()
      await expect(repo.definirQr('nao-existe', QR_OK)).rejects.toBeInstanceOf(ErroAdmin)
      await expect(repo.removerQr('nao-existe')).rejects.toBeInstanceOf(ErroAdmin)
    })

    it('obterGeometria devolve a geometria do ambiente e null sem geometria', async () => {
      const repo = criar()
      const { a } = await primeiro(repo)
      const g = await repo.obterGeometria(OBRA, { id: a.ambiente_id, codigo: a.codigo })
      expect(g?.contorno.length).toBe(a.contorno.length)
      expect(await repo.obterGeometria(OBRA, { id: 'x', codigo: 'sem-geometria' })).toBeNull()
    })
  })
}

// O vitest exige ao menos um teste em todo *.test.ts; as implementações chamam a função acima.
it('exporta o contrato reutilizável', () => expect(typeof contratoRaRepositorio).toBe('function'))
