import { CAMPOS_VAZIOS } from '@modules/obras/infra/camposEtapa.ts'
import { criarEtapasAdminFixture, type EtapaMemoria } from '../../infra/EtapasAdminFixtureAdapter.ts'
import { criarObrasAdminFixture, type ObraMemoria } from '../../infra/ObrasAdminFixtureAdapter.ts'
import { criarOrganizacaoAdminFixture } from '../../infra/OrganizacaoAdminFixtureAdapter.ts'
import { contratoEtapasAdminRepositorio } from './EtapasAdminRepositorio.contract.ts'
import { contratoObrasAdminRepositorio } from './ObrasAdminRepositorio.contract.ts'
import { contratoOrganizacaoAdminRepositorio } from './OrganizacaoAdminRepositorio.contract.ts'

const semRede = () => {}
const USUARIOS = [
  { id: 'usuario-patricio', nome: 'Patrício Ferreira', username: null, telegram_id: 2 },
  { id: 'usuario-eduardo', nome: 'Eduardo Lima', username: null, telegram_id: 3 },
]

/** Estado novo a cada chamada (nada é compartilhado entre os testes). */
function semente() {
  const etapas: EtapaMemoria[] = [
    {
      ...CAMPOS_VAZIOS,
      id: 'etapa-2a',
      slug: '2a-etapa',
      nome: '2ª ETAPA',
      ordem: 2,
      telegram_chat_id: -100,
      telegram_chat_titulo: 'Grupo 2ª',
      arquivada_em: null,
      sigla: '2',
      latitude: -3.7,
      longitude: -38.5,
      fuso: 'America/Fortaleza',
      aditivos: [{ id: 'aditivo-1', etapa_id: 'etapa-2a', numero: '1º TA', data: '2026-03-10', prazo_dias: 90, valor: 1000, descricao: null }],
      responsaveis: [{ usuario_id: 'usuario-patricio', funcao: 'Fiscal' }],
    },
    {
      ...CAMPOS_VAZIOS,
      id: 'etapa-3a',
      slug: '3a-etapa',
      nome: '3ª ETAPA',
      ordem: 3,
      telegram_chat_id: null,
      telegram_chat_titulo: null,
      arquivada_em: null,
      sigla: '3',
      aditivos: [],
      responsaveis: [],
    },
  ]
  const obras: ObraMemoria[] = [
    {
      id: 'obra-hto',
      slug: 'hto',
      nome: 'HTO',
      ordem: 0,
      pavimentos: [{ id: 'hto-terreo', codigo: 'terreo', nome: 'Térreo', ordem: 1, ambientes: 3 }],
      config: null,
      config_atualizada_em: null,
      config_atualizada_por: null,
      arquivada_em: null,
      etapa_id: 'etapa-2a',
      telegram_chat_id: -100,
    },
  ]
  let id = 0
  const obrasAdm = criarObrasAdminFixture({
    obras,
    etapas,
    exigirAdmin: semRede,
    proximoId: () => ++id,
    nomeUsuario: 'Você (teste)',
    contagens: () => ({ ambientes: 3, plantas: 1, modelos: 0, arquivos: { fotos: 0, plantas: 1, originais: 0, modelos: 0 } }),
    removerArquivos: () => ({ plantas: 1 }),
  })
  const etapasAdm = criarEtapasAdminFixture({
    etapas,
    obras,
    usuarios: USUARIOS,
    nomeExibicao: () => null,
    exigirAdmin: semRede,
    proximoId: () => ++id,
    resumoObra: obrasAdm.resumoDe,
    removerObra: obrasAdm.removerObra,
    aoExcluirEtapa: semRede,
  })
  return { obrasAdm, etapasAdm }
}

contratoEtapasAdminRepositorio('fixture', () => semente().etapasAdm)
contratoObrasAdminRepositorio('fixture', () => semente().obrasAdm)
contratoOrganizacaoAdminRepositorio('fixture', () => criarOrganizacaoAdminFixture({ exigirAdmin: semRede }))
