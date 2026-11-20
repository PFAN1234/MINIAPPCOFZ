import { somarDias } from '@shared/kernel/periodo.ts'
import { hojeNoFuso } from '../../../../admin/formato.ts'
import { criarRepositorioAdminFixture } from '../../../../admin/dados/fixture.ts'
import { contratoBoletinsAdmin } from './BoletinsAdminRepositorio.contract.ts'

contratoBoletinsAdmin('fixture', () => ({
  repo: criarRepositorioAdminFixture(),
  etapaSlug: '2a-etapa',
  dataSemPedido: somarDias(hojeNoFuso('America/Fortaleza'), -10),
}))
