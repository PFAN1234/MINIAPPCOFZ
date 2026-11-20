import { criarRepositorioFixture } from '../../../../dados/fixture.ts'
import { contratoPublicacoes } from './PublicacoesRepositorio.contract.ts'
import { contratoRegistros } from './RegistrosRepositorio.contract.ts'

const ID_HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const PENDENCIA_ABERTA = '00000000-0000-4000-8000-000000000101'
const PENDENCIA_RESOLVIDA = '00000000-0000-4000-8000-000000000106'

contratoRegistros('fixture', () => ({
  repo: criarRepositorioFixture(),
  obraId: ID_HTO,
  obraSlug: 'hto',
  ambienteId: 'terreo-apto-101',
  pendenciaAbertaId: PENDENCIA_ABERTA,
  pendenciaResolvidaId: PENDENCIA_RESOLVIDA,
}))

contratoPublicacoes('fixture', () => ({
  repo: criarRepositorioFixture(),
  obraId: ID_HTO,
  publicacaoFalhouId: 1,
  publicacaoIncertoId: 2,
}))
