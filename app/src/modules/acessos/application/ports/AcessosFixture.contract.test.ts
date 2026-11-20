import { criarAcessosAdminFixture } from '../../infra/AcessosAdminFixtureAdapter.ts'
import { criarAcessosFixture } from '../../infra/AcessosFixtureAdapter.ts'
import { criarEquipeServicoFixture } from '../../infra/EquipeServicoFixtureAdapter.ts'
import { criarSessaoFixture } from '../../infra/SessaoFixtureAdapter.ts'
import { contratoAcessosAdminRepositorio } from './AcessosAdminRepositorio.contract.ts'
import { contratoAcessosRepositorio } from './AcessosRepositorio.contract.ts'
import { contratoEquipeServicoRepositorio } from './EquipeServicoRepositorio.contract.ts'
import { contratoSessaoRepositorio } from './SessaoRepositorio.contract.ts'

const ETAPA_2 = { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02', nome: '2ª ETAPA', ordem: 2 }
const ETAPA_3 = { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b03', nome: '3ª ETAPA', ordem: 3 }
const ETAPA_4 = { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b04', nome: '4ª ETAPA', ordem: 4 }
const OBRAS = [
  { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01', slug: 'hto', nome: 'HTO', etapa: ETAPA_2 },
  { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02', slug: 'aurora', nome: 'Residencial Aurora', etapa: ETAPA_2 },
  { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e04', slug: 'alojamentos', nome: 'Bloco de Alojamentos', etapa: ETAPA_3 },
]
const semRede = () => {}

contratoAcessosRepositorio('fixture', () =>
  criarAcessosFixture({
    admin: false,
    estado: { pedidos: {}, decisoes: {}, papeis: {}, removidos: [] },
    persistir: semRede,
    exigirRede: semRede,
    obras: OBRAS,
  }),
)

contratoEquipeServicoRepositorio('fixture', () =>
  criarEquipeServicoFixture({ etapas: [ETAPA_2, ETAPA_3, ETAPA_4], etapaSemParticipacao: ETAPA_4.id, exigirRede: semRede }),
)

contratoSessaoRepositorio('fixture', (admin) =>
  criarSessaoFixture({ admin, idUsuario: 'usuario-teste', exigirRede: semRede }),
)

const VOCE = { id: 'usuario-teste', nome: 'Você (teste)', username: 'voce', telegram_id: 1, eh_admin: true }
contratoAcessosAdminRepositorio('fixture', () =>
  criarAcessosAdminFixture({
    admin: true,
    voce: VOCE,
    usuarios: [
      { id: VOCE.id, nome: VOCE.nome, username: VOCE.username, telegram_id: 1 },
      { id: 'usuario-patricio', nome: 'Patrício Ferreira', username: null, telegram_id: 2 },
      { id: 'usuario-maria', nome: 'Maria Souza', username: 'maria', telegram_id: 3 },
    ],
    obras: () => [
      { id: 'obra-hto', slug: 'hto', nome: 'HTO', etapaNome: '2ª ETAPA' },
      { id: 'obra-cofz', slug: 'cofz', nome: 'COFZ', etapaNome: '2ª ETAPA' },
    ],
    exigirAdmin: semRede,
  }),
)
