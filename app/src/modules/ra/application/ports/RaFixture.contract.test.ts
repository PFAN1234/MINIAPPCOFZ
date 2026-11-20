import { criarRaFixture } from '../../infra/RaFixtureAdapter.ts'
import { contratoRaRepositorio } from './RaRepositorio.contract.test.ts'

contratoRaRepositorio('fixture', () => criarRaFixture())
