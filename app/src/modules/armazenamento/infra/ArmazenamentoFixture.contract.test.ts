import { contratoArmazenamento } from '../application/ports/Armazenamento.contract.ts'
import { criarArmazenamentoFixture } from './ArmazenamentoFixtureAdapter.ts'

contratoArmazenamento('fixture', () => criarArmazenamentoFixture())
