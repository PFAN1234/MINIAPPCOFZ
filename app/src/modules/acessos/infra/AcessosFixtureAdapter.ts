import { ErroEnvio } from '../../../dados/erros.ts'
import { nomeMostrado } from '../../../dados/nome.ts'
import type { AcessosRepositorio } from '../application/ports/AcessosRepositorio.port.ts'
import type {
  MatrizAcessos,
  ObraDisponivel,
  PapelAcesso,
  PapelObra,
  Participante,
  SolicitacaoAcesso,
} from '../domain/tipos.ts'

export const ID_USUARIO = 'usuario-teste'
const ID_DEMONSTRACAO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e03'
const ID_PEDIDO_MARIA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4f01'
const ID_MARCOS = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a02'
const ID_JOAO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a03'
export const ID_PATRICIO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a04'
const ID_ANA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a05'

/**
 * Pessoa com nome de exibição (definido pelo admin no site): o app mostra `CP PATRICIO`, e não o
 * nome do Telegram. As demais pessoas da fixture não têm nome de exibição e aparecem pelo do Telegram.
 */
const PATRICIO = { nome: 'Patricio Ferreira', nome_exibicao: 'CP PATRICIO' }
export const NOME_PATRICIO = nomeMostrado(PATRICIO)!

const PEDIDO_MARIA: SolicitacaoAcesso = {
  id: ID_PEDIDO_MARIA,
  usuario_id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a01',
  nome: 'Maria Souza',
  username: 'maria',
  criado_em: '2026-11-09T18:30:00Z',
}

export const PARTICIPANTES_BASE: (Participante & { papel_inicial: PapelObra })[] = [
  { usuario_id: ID_USUARIO, nome: 'Você (teste)', username: 'voce', papel: 'gestor', papel_inicial: 'gestor', desde: '2026-10-20T12:00:00Z' },
  { usuario_id: ID_MARCOS, nome: 'Marcos Teixeira', username: 'marcos', papel: 'equipe', papel_inicial: 'equipe', desde: '2026-10-22T14:30:00Z' },
  { usuario_id: ID_JOAO, nome: 'João Lima', username: 'joao', papel: 'equipe', papel_inicial: 'equipe', desde: '2026-10-25T09:10:00Z' },
  { usuario_id: ID_PATRICIO, nome: NOME_PATRICIO, username: 'patricio', papel: 'equipe', papel_inicial: 'equipe', desde: '2026-10-26T11:00:00Z' },
]

/** Parte do estado persistido da fixture que pertence a este contexto (mutada in-place). */
export interface EstadoAcessosFixture {
  /** Pedidos de acesso do usuário de teste por obra. */
  pedidos: Record<string, 'pendente' | 'recusada'>
  /** Decisões do gestor sobre os pedidos de outras pessoas, por id do pedido. */
  decisoes: Record<string, 'aprovada' | 'recusada'>
  /** Papel dos participantes que o gestor mudou. */
  papeis: Record<string, PapelObra>
  /** Participantes removidos pelo gestor. */
  removidos: string[]
}

export interface OpcoesAcessosFixture {
  /** O usuário de teste é admin do Mini App? */
  admin: boolean
  estado: EstadoAcessosFixture
  persistir: () => void
  exigirRede: () => void
  /** Obras da fixture (estado de outro contexto): HTO, Aurora (`slug: aurora`) e Alojamentos. */
  obras: { id: string; slug: string; nome: string; etapa: { id: string; nome: string; ordem: number } }[]
}

export type AcessosFixture = AcessosRepositorio & {
  papelUsuario(): PapelObra
  exigirGestor(obraId: string): void
  participantesAtuais(): Participante[]
}

function falhaValidacao(msg: string): never {
  throw new ErroEnvio('validacao', msg)
}

export function criarAcessosFixture(o: OpcoesAcessosFixture): AcessosFixture {
  const { pedidos, decisoes, papeis, removidos } = o.estado
  const { persistir, exigirRede, obras: OBRAS } = o
  const idDe = (slug: string) => OBRAS.find((x) => x.slug === slug)!.id
  const ID_HTO = idDe('hto')
  const etapaDemo = OBRAS[0].etapa

  /** Obra em que o usuário de teste está no grupo do Telegram, mas sem acesso. */
  const OBRA_DEMONSTRACAO = { id: ID_DEMONSTRACAO, slug: 'demonstracao', nome: 'Obra Demonstração' }

  // Lista de acessos: só em memória. A HTO segue os participantes; as outras obras, esta tabela.
  const acessosFora: Record<string, Record<string, 'equipe' | 'gestor'>> = {
    [idDe('aurora')]: { [ID_MARCOS]: 'equipe' },
    [idDe('alojamentos')]: {},
  }
  const adminsDoGrupo = [ID_ANA]
  const outrasPessoas = {
    [ID_ANA]: { nome: 'Ana Prado', username: 'anaprado' },
    [PEDIDO_MARIA.usuario_id]: { nome: PEDIDO_MARIA.nome, username: PEDIDO_MARIA.username },
  }

  function papelUsuario(): PapelObra {
    return papeis[ID_USUARIO] ?? 'gestor'
  }

  function exigirGestor(obraId: string): void {
    if (obraId !== ID_HTO || papelUsuario() !== 'gestor') {
      throw new ErroEnvio('permissao', 'Só gestores da obra podem fazer isto.')
    }
  }

  function participantesAtuais(): Participante[] {
    return PARTICIPANTES_BASE.filter((p) => !removidos.includes(p.usuario_id)).map(
      ({ papel_inicial, ...p }) => ({ ...p, papel: papeis[p.usuario_id] ?? papel_inicial }),
    )
  }

  function papelNaObra(obraId: string, usuarioId: string): 'nenhum' | 'equipe' | 'gestor' {
    if (adminsDoGrupo.includes(usuarioId)) return 'gestor'
    if (obraId === ID_HTO) {
      const p = participantesAtuais().find((x) => x.usuario_id === usuarioId)
      return p ? p.papel : (acessosFora[ID_HTO]?.[usuarioId] ?? 'nenhum')
    }
    return acessosFora[obraId]?.[usuarioId] ?? 'nenhum'
  }

  function exigirOutroGestor(usuarioId: string): void {
    const outros = participantesAtuais().filter((p) => p.papel === 'gestor' && p.usuario_id !== usuarioId)
    if (outros.length === 0) {
      throw new ErroEnvio('validacao', 'A obra precisa de pelo menos um gestor.')
    }
  }

  return {
    papelUsuario,
    exigirGestor,
    participantesAtuais,

    async obrasDisponiveis(): Promise<ObraDisponivel[]> {
      return [
        {
          ...OBRA_DEMONSTRACAO,
          solicitacao: pedidos[ID_DEMONSTRACAO] ?? null,
          etapa_id: etapaDemo.id,
          etapa_nome: etapaDemo.nome,
          etapa_ordem: etapaDemo.ordem,
        },
      ]
    },

    async solicitarAcesso(obraId) {
      exigirRede()
      if (obraId !== ID_DEMONSTRACAO) {
        throw new ErroEnvio('permissao', 'Entre no grupo da obra no Telegram para pedir acesso.')
      }
      pedidos[obraId] = 'pendente'
      persistir()
    },

    async listarSolicitacoes(obraId) {
      if (obraId !== ID_HTO) {
        throw new ErroEnvio('permissao', 'Só gestores da obra veem os pedidos de acesso.')
      }
      return decisoes[ID_PEDIDO_MARIA] ? [] : [{ ...PEDIDO_MARIA }]
    },

    async decidirSolicitacao(id, aprovar) {
      exigirRede()
      if (id !== ID_PEDIDO_MARIA) throw new ErroEnvio('nao_encontrado', 'Pedido não encontrado.')
      const nova = aprovar ? 'aprovada' : 'recusada'
      const atual = decisoes[id]
      if (atual && atual !== nova) throw new ErroEnvio('conflito', 'Pedido já decidido.')
      decisoes[id] = nova
      if (aprovar) (acessosFora[ID_HTO] ??= {})[PEDIDO_MARIA.usuario_id] ??= 'equipe'
      persistir()
    },

    async matrizAcessos(): Promise<MatrizAcessos> {
      if (papelUsuario() !== 'gestor' && o.admin !== true) {
        throw new ErroEnvio('permissao', 'Só gestores veem a lista de acessos.')
      }
      const nomes: Record<string, { nome: string; username: string | null }> = {
        ...outrasPessoas,
        ...Object.fromEntries(PARTICIPANTES_BASE.map((p) => [p.usuario_id, { nome: p.nome, username: p.username }])),
      }
      const pedidoMaria = decisoes[ID_PEDIDO_MARIA] ? [] : [ID_HTO]
      const pessoas = Object.entries(nomes).map(([id, n]) => {
        const acessos: Record<string, 'equipe' | 'gestor'> = {}
        for (const ob of OBRAS) {
          const papel = papelNaObra(ob.id, id)
          if (papel !== 'nenhum') acessos[ob.id] = papel
        }
        return {
          id,
          nome: n.nome,
          username: n.username,
          admin: adminsDoGrupo.includes(id),
          vistoEm: '2026-11-15T14:00:00Z',
          acessos,
          pedidos: id === PEDIDO_MARIA.usuario_id ? pedidoMaria : [],
        }
      })
      pessoas.sort(
        (a, b) =>
          Number(b.pedidos.length > 0) - Number(a.pedidos.length > 0) ||
          a.nome.localeCompare(b.nome, 'pt-BR') ||
          a.id.localeCompare(b.id),
      )
      return { obras: OBRAS.map((ob) => ({ id: ob.id, slug: ob.slug, nome: ob.nome })), pessoas }
    },

    async definirAcesso(obraId, usuarioId, papel: PapelAcesso) {
      exigirRede()
      if (papelUsuario() !== 'gestor' && o.admin !== true) {
        throw new ErroEnvio('permissao', 'Só gestores alteram acessos.')
      }
      if (papel !== 'nenhum' && papel !== 'equipe' && papel !== 'gestor') falhaValidacao('Acesso inválido.')
      if (!OBRAS.some((ob) => ob.id === obraId)) throw new ErroEnvio('nao_encontrado', 'Obra não encontrada.')
      if (adminsDoGrupo.includes(usuarioId) && papel !== 'gestor') {
        falhaValidacao('Administradores do grupo são gestores de todas as obras.')
      }
      const atual = papelNaObra(obraId, usuarioId)
      if (atual === 'gestor' && papel !== 'gestor') {
        const gestores = [...PARTICIPANTES_BASE.map((p) => p.usuario_id), ...Object.keys(outrasPessoas)].filter(
          (id) => id !== usuarioId && papelNaObra(obraId, id) === 'gestor',
        )
        if (gestores.length === 0) falhaValidacao('A obra precisa de pelo menos um gestor.')
      }
      const base = obraId === ID_HTO && PARTICIPANTES_BASE.some((p) => p.usuario_id === usuarioId)
      if (base) {
        const i = removidos.indexOf(usuarioId)
        if (papel === 'nenhum') {
          if (i < 0) removidos.push(usuarioId)
        } else {
          if (i >= 0) removidos.splice(i, 1)
          papeis[usuarioId] = papel
        }
      } else {
        const tabela = (acessosFora[obraId] ??= {})
        if (papel === 'nenhum') delete tabela[usuarioId]
        else tabela[usuarioId] = papel
      }
      if (obraId === ID_HTO && usuarioId === PEDIDO_MARIA.usuario_id) {
        decisoes[ID_PEDIDO_MARIA] ??= papel === 'nenhum' ? 'recusada' : 'aprovada'
      }
      persistir()
    },

    async listarParticipantes(obraId) {
      exigirGestor(obraId)
      return participantesAtuais().sort(
        (a, b) =>
          Number(b.papel === 'gestor') - Number(a.papel === 'gestor') ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      )
    },

    async definirPapel(obraId, usuarioId, papel) {
      exigirRede()
      exigirGestor(obraId)
      if (papel !== 'equipe' && papel !== 'gestor') falhaValidacao('Papel inválido')
      const atual = participantesAtuais().find((p) => p.usuario_id === usuarioId)
      if (!atual) throw new ErroEnvio('nao_encontrado', 'Participante não encontrado.')
      if (atual.papel === 'gestor' && papel === 'equipe') exigirOutroGestor(usuarioId)
      papeis[usuarioId] = papel
      persistir()
    },

    async removerParticipante(obraId, usuarioId) {
      exigirRede()
      exigirGestor(obraId)
      const atual = participantesAtuais().find((p) => p.usuario_id === usuarioId)
      if (!atual) throw new ErroEnvio('nao_encontrado', 'Participante não encontrado.')
      if (atual.papel === 'gestor') exigirOutroGestor(usuarioId)
      removidos.push(usuarioId)
      persistir()
    },
  }
}
