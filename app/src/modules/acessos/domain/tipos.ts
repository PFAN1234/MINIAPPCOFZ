/** Tipos puros do contexto `acessos`: sessão, acessos, pessoas, admins e equipe de serviço. */

export type PapelObra = 'equipe' | 'gestor'

/** Obra em que o usuário está no grupo do Telegram mas ainda não tem acesso. */
export interface ObraDisponivel {
  id: string
  slug: string
  nome: string
  /** Estado do pedido mais recente; `null` se nunca pediu. */
  solicitacao: 'pendente' | 'recusada' | null
  etapa_id: string
  etapa_nome: string
  etapa_ordem: number
}

/** Pedido de acesso pendente, visto pelo gestor da obra. */
export interface SolicitacaoAcesso {
  id: string
  usuario_id: string
  nome: string
  username: string | null
  criado_em: string
}

/** Pessoa da lista de acessos (RPC `matriz_acessos`). */
export interface PessoaAcesso {
  id: string
  nome: string
  username: string | null
  /** Administradora do grupo: gestora de todas as obras. */
  admin: boolean
  /** Última vez que o bot viu a pessoa no grupo ou no app. */
  vistoEm: string | null
  /** Só as obras em que a pessoa participa, por id da obra. */
  acessos: Record<string, 'equipe' | 'gestor'>
  /** Ids das obras com pedido de acesso pendente. */
  pedidos: string[]
}

export interface MatrizAcessos {
  obras: { id: string; slug: string; nome: string }[]
  pessoas: PessoaAcesso[]
}

export type PapelAcesso = 'nenhum' | 'equipe' | 'gestor'

export interface Participante {
  usuario_id: string
  nome: string
  username: string | null
  papel: PapelObra
  desde: string
}

/** Link de uso único para abrir o site de administração (vale 2 min). */
export interface LinkAdmin {
  url: string
  expira_em: string
}

/** Um serviço (entrada e saída) da equipe de uma etapa. */
export interface MembroServico {
  id: string
  usuario_id: string
  nome: string
  entrada_em: string
  saida_em: string | null
  /** Fechado sozinho 24 h depois da entrada ("saída não registrada"). */
  saida_automatica: boolean
  /** É o próprio usuário. */
  eu: boolean
}

export interface ServicoAberto {
  id: string
  etapa_id: string
  etapa_nome: string
  entrada_em: string
}

/** Equipe de serviço de uma etapa (`equipe_servico`, `fazer_checkin`, `fazer_checkout`). */
export interface EquipeServico {
  etapa_id: string
  participa: boolean
  /** A etapa tem coordenada cadastrada (sem ela, o check-in não vale). */
  tem_localizacao: boolean
  /** Serviço aberto do usuário em qualquer etapa. */
  meu_servico: ServicoAberto | null
  equipe: MembroServico[]
}

/** Posição do GPS do aparelho. */
export interface Posicao {
  latitude: number
  longitude: number
  precisao: number | null
}

export interface UsuarioSessao {
  id: string
  nome: string
}

export type EstadoSessao =
  | { tipo: 'sem_sessao' }
  | { tipo: 'negado'; usuario: UsuarioSessao }
  | { tipo: 'admin'; usuario: UsuarioSessao }

export interface ParticipacaoPessoa {
  obra_slug: string
  obra_nome: string
  etapa_nome: string
  papel: string
}

/** `admin_listar_pessoas`. */
export interface Pessoa {
  id: string
  nome: string
  nome_exibicao: string | null
  username: string | null
  telegram_id: number
  eh_admin: boolean
  participacoes: ParticipacaoPessoa[]
}

/** `matriz_acessos()`: obras e, por pessoa, o papel em cada obra (por id) e os pedidos pendentes. */
export interface MatrizAcessosAdmin {
  obras: { id: string; slug: string; nome: string }[]
  pessoas: {
    id: string
    nome: string
    username: string | null
    admin: boolean
    vistoEm: string | null
    acessos: Record<string, 'equipe' | 'gestor'>
    /** Ids das obras em que a pessoa pediu acesso e ainda não foi decidido. */
    pedidos: string[]
  }[]
}

export interface Admin {
  usuario_id: string
  nome: string
  username: string | null
  telegram_id: number
  criado_em: string
  criado_por_nome: string | null
}

export interface UsuarioApp {
  id: string
  nome: string
  username: string | null
  telegram_id: number
  eh_admin: boolean
}

/** Objeto que o Telegram Login Widget entrega ao `data-onauth`. */
export interface DadosWidget {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}
