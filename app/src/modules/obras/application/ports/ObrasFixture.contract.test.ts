import type { Ambiente, ObraDaLista, Pavimento } from '../../domain/tipos.ts'
import { criarEtapasInicioFixture } from '../../infra/EtapasInicioFixtureAdapter.ts'
import { criarObrasFixture } from '../../infra/ObrasFixtureAdapter.ts'
import { criarOrganizacaoFixture } from '../../infra/OrganizacaoFixtureAdapter.ts'
import { contratoEtapasInicioRepositorio } from './EtapasInicioRepositorio.contract.ts'
import { contratoObrasRepositorio } from './ObrasRepositorio.contract.ts'
import { contratoOrganizacaoRepositorio } from './OrganizacaoRepositorio.contract.ts'

const ETAPA_2 = { id: 'etapa-2', slug: '2a-etapa', nome: '2ª ETAPA', ordem: 2 }
const ETAPA_4 = { id: 'etapa-4', slug: '4a-etapa', nome: '4ª ETAPA', ordem: 4 }
const OBRAS: ObraDaLista[] = [
  { id: 'obra-hto', slug: 'hto', nome: 'HTO', etapa: ETAPA_2 },
  { id: 'obra-aurora', slug: 'aurora', nome: 'Aurora', etapa: ETAPA_2 },
]
const PAVIMENTOS: Pavimento[] = [{ id: 'terreo', codigo: 'terreo', nome: 'Térreo', ordem: 0, planta: null }]
const AMBIENTES: Omit<Ambiente, 'pendencias_abertas'>[] = [
  { id: 'a1', codigo: 'terreo-101', pavimento_codigo: 'terreo', nome_operacional: 'Apto 101', nome_planta: null, categoria: 'apto', area_m2: 20, marcadores: [], ativo: true },
]

contratoObrasRepositorio('fixture', () => ({
  repo: criarObrasFixture({
    obras: OBRAS,
    obraComDados: 'obra-hto',
    pavimentos: PAVIMENTOS,
    ambientes: AMBIENTES,
    detalhePlanta: () => null,
    registros: () => [{ obra: { id: 'obra-hto' }, ambiente: { id: 'a1' }, tipo: 'pendencia', situacao: 'aberta' }],
    papelUsuario: () => 'gestor',
  }),
  slug: 'hto',
  obraId: 'obra-hto',
  ambiente: 'terreo-101',
  pavimento: 'terreo',
}))

contratoOrganizacaoRepositorio('fixture', () => criarOrganizacaoFixture(null))
contratoEtapasInicioRepositorio('fixture', () => criarEtapasInicioFixture([ETAPA_2, ETAPA_4], ETAPA_4.id))
