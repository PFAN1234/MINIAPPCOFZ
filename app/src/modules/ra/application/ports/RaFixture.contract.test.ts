import { criarRaFixture } from '../../infra/RaFixtureAdapter.ts'
import { contratoRaRepositorio } from './RaRepositorio.contract.ts'

contratoRaRepositorio('fixture', () => criarRaFixture())
