import { ErroAdmin } from '../../../../admin/dados/tipos.ts'
import { criarPlantasFixture, type ObraPlantaFixture } from '../../infra/PlantasFixtureAdapter.ts'
import { contratoPlantasRepositorio } from './PlantasRepositorio.contract.ts'

contratoPlantasRepositorio('fixture', () => {
  const obra: ObraPlantaFixture = {
    id: 'obra-hto',
    slug: 'hto',
    nome: 'HTO',
    config: null,
    config_atualizada_em: null,
    config_atualizada_por: null,
    pavimentos: [
      { codigo: 'terreo', nome: 'Térreo', ordem: 1, ambientes: 0 },
      { codigo: '1pav', nome: '1º pavimento', ordem: 2, ambientes: 0 },
    ],
  }
  const repo = criarPlantasFixture({
    obraPorSlug: (slug) => {
      if (slug !== obra.slug) throw new ErroAdmin('Obra não encontrada')
      return obra
    },
    obraExiste: (id) => id === obra.id,
  })
  return { repo, slug: 'hto', obraId: 'obra-hto', pavimento: 'terreo' }
})
