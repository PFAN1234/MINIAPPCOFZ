import { criarRepositorioAdminFixture } from '../../../../admin/dados/fixture.ts'
import { criarRepositorioFixture } from '../../../../dados/fixture.ts'
import type { RaRepositorio } from './RaRepositorio.port.ts'
import { contratoRaRepositorio } from './RaRepositorio.contract.test.ts'

contratoRaRepositorio('fixture', (): RaRepositorio => {
  const dados = criarRepositorioFixture()
  const admin = criarRepositorioAdminFixture({ admin: true })
  return {
    obterGeometria: (obra, ambiente) => dados.obterGeometria(obra, ambiente),
    listarRA: (obraId) => admin.listarRA(obraId),
    definirQr: (id, qr) => admin.definirQr(id, qr),
    removerQr: (id) => admin.removerQr(id),
  }
})
