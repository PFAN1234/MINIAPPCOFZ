import { describe, expect, it } from 'vitest'
import type { Posicao } from '../../domain/tipos.ts'
import type { EquipeServicoRepositorio } from './EquipeServicoRepositorio.port.ts'

const ETAPA_2 = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02'
const ETAPA_3 = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b03'
const ETAPA_4 = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b04'
const POS: Posicao = { latitude: 0, longitude: 0, precisao: 5 }

/** Comportamento que toda implementação de `EquipeServicoRepositorio` deve cumprir (fixture). */
export function contratoEquipeServicoRepositorio(nome: string, criar: () => EquipeServicoRepositorio) {
  describe(`EquipeServicoRepositorio (${nome})`, () => {
    it('check-in coloca o usuário na equipe e check-out o tira de serviço', async () => {
      const repo = criar()
      const dentro = await repo.fazerCheckin(ETAPA_2, POS)
      expect(dentro.meu_servico?.etapa_id).toBe(ETAPA_2)
      expect(dentro.equipe.some((m) => m.eu && m.saida_em === null)).toBe(true)
      const fora = await repo.fazerCheckout()
      expect(fora.equipe.find((m) => m.eu)?.saida_em).not.toBeNull()
      expect((await repo.equipeServico(ETAPA_2)).meu_servico).toBeNull()
    })

    it('segundo check-in sem sair é conflito', async () => {
      const repo = criar()
      await repo.fazerCheckin(ETAPA_2, POS)
      await expect(repo.fazerCheckin(ETAPA_3, POS)).rejects.toMatchObject({ tipo: 'conflito' })
    })

    it('etapa em que o usuário não participa nega o check-in', async () => {
      const repo = criar()
      expect((await repo.equipeServico(ETAPA_4)).participa).toBe(false)
      await expect(repo.fazerCheckin(ETAPA_4, POS)).rejects.toMatchObject({ tipo: 'permissao' })
    })

    it('check-out sem estar de serviço dá nao_encontrado', async () => {
      await expect(criar().fazerCheckout()).rejects.toMatchObject({ tipo: 'nao_encontrado' })
    })
  })
}
