import { criarRepositorioAdminFixture } from '../../../../admin/dados/fixture.ts'
import { contratoTelemetria } from './TelemetriaRepositorio.contract.ts'

contratoTelemetria('fixture', () => criarRepositorioAdminFixture())
