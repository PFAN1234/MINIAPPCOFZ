/** Tipos do domínio usados pelo app (independentes da origem dos dados). */
import type { DadosRA, OrigemFoto } from '../ra/tipos.ts'

/** Marcador normalizado na página do PDF (0 a 1, origem no canto superior esquerdo). */
export interface Marcador {
  x: number
  y: number
}

/** `[x0, y0, x1, y1]` em pontos do PDF, origem no canto superior esquerdo. */
export type RecortePt = [number, number, number, number]

export interface ObraResumo {
  id: string
  slug: string
  nome: string
}

/** Etapa de implantação do campus: agrupa obras (e tem um grupo do Telegram). */
export interface Etapa {
  id: string
  slug: string
  nome: string
  ordem: number
}

/** Obra da tela inicial (`listarObras`), com a etapa a que pertence. */
export interface ObraDaLista extends ObraResumo {
  etapa: Etapa
}

/** Identidade da organização militar (RPC `organizacao`). */
export interface Organizacao {
  nome: string
  /** URL pública do logo no bucket `organizacao`; `null` se não houver logo. */
  logo_url: string | null
}

export interface ImagemPlanta {
  /** Caminho no bucket `plantas`: `<obra_id>/<revisao>/<pavimento>/...`. */
  path: string
  largura: number
  altura: number
}

export interface Planta {
  id: string
  revisao: string
  /** `[largura, altura]` da página, em pontos. */
  pagina_pt: [number, number]
  recorte_pt: RecortePt
  imagem: ImagemPlanta
  imagem_hd: ImagemPlanta | null
}

export interface Pavimento {
  id: string
  codigo: string
  nome: string
  ordem: number
  /** Planta ativa do pavimento; `null` se ainda não foi publicada. */
  planta: Planta | null
}

export interface Ambiente {
  id: string
  codigo: string
  pavimento_codigo: string
  nome_operacional: string
  nome_planta: string | null
  categoria: string
  area_m2: number | null
  marcadores: Marcador[]
  pendencias_abertas: number
  /**
   * `false` quando o ambiente não existe na planta vigente (saiu numa revisão).
   * Fica fora da lista, da busca e da planta, mas a tela dele abre (histórico).
   */
  ativo: boolean
}

export type PapelObra = 'equipe' | 'gestor'

/** Totais de uma obra para o Início (`resumo_obras`): serviços de sempre, pendências abertas e resolvidas. */
export interface ResumoObra {
  obra_id: string
  /** Papel do usuário na obra; `null` quando vê a obra sem participar (admin). */
  papel: PapelObra | null
  servicos: number
  abertas: number
  resolvidas: number
}

export interface ObraDetalhe {
  obra: ObraResumo
  /** Papel do usuário na obra (da própria participação). */
  papel: PapelObra
  pavimentos: Pavimento[]
  /** Todos os ambientes, inclusive os inativos (as telas filtram por `ativo`). */
  ambientes: Ambiente[]
}

export interface DetalhePlanta {
  imagem: ImagemPlanta
  recorte_pt: RecortePt
}

export interface AmbienteDetalhe {
  obra: ObraResumo
  ambiente: Ambiente
  pavimento: Pavimento
  planta: Planta | null
  detalhe: DetalhePlanta | null
}

export type TipoRegistro = 'servico' | 'pendencia'
export type SituacaoRegistro = 'aberta' | 'resolvida'

export type EstadoPublicacao = 'pendente' | 'enviando' | 'publicado' | 'incerto' | 'falhou'

export interface FotoRegistro {
  id: string
  /** Caminho no bucket `fotos`: `<obra_id>/<registro_id>/<foto_id>.jpg`. */
  path: string
  largura: number
  altura: number
  /** `ra_limpa` e `ra_modelo` são o par tirado na realidade aumentada. */
  origem?: OrigemFoto
}

export interface RegistroResumo {
  id: string
  tipo: TipoRegistro
  situacao: SituacaoRegistro | null
  legenda: string
  autor: string
  capturado_em: string
  recebido_em: string
  /** `pavimento` (nome) vem preenchido nas consultas do app; opcional para quem monta resumos à mão. */
  ambiente: { id: string; codigo: string; nome: string; pavimento?: string }
  obra: { id: string; slug: string; nome: string }
  /** Ordenadas por `ordem`. */
  fotos: FotoRegistro[]
  /** `null` se o registro não tem publicação (ou ela não é visível). */
  publicacao: EstadoPublicacao | null
}

/** Dados de uma foto na conclusão do registro; `origem` e `ra` só nas fotos da realidade aumentada. */
export interface FotoEnviada {
  id: string
  largura: number
  altura: number
  bytes: number
  origem?: Exclude<OrigemFoto, 'normal'>
  ra?: DadosRA
}

export interface NovoRegistro {
  id: string
  ambienteId: string
  tipo: TipoRegistro
  legenda: string
  /** ISO. */
  capturadoEm: string
  /** Na ordem escolhida. */
  fotos: FotoEnviada[]
}

export interface CaminhoFoto {
  obraId: string
  registroId: string
  fotoId: string
}

export interface FiltroRegistros {
  obraId?: string
  /** Slug da obra (usado pelas filtragens vindas da URL). */
  obraSlug?: string
  ambienteId?: string
  /** Código do ambiente; só faz sentido junto com a obra. */
  ambienteCodigo?: string
  tipo?: TipoRegistro
  situacao?: SituacaoRegistro
  /** Etapa da obra do registro. */
  etapaId?: string
  /** Id do autor. */
  autorId?: string
  /** Período de `capturado_em` (`AAAA-MM-DD`, fuso de Fortaleza); cada lado é opcional. */
  de?: string
  ate?: string
  limite?: number
}

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

export interface RegistroLocalizado {
  slug: string
  /** Código do ambiente do registro. */
  codigo: string
  tipo: TipoRegistro
}

/** Encerramento de uma pendência: fotos de comprovação e observação do gestor. */
export interface Encerramento {
  id: string
  observacao: string | null
  encerrado_em: string
  /** Nome do gestor que encerrou. */
  gestor: string
  /** Ordenadas por `ordem`. */
  fotos: FotoRegistro[]
  publicacao: EstadoPublicacao | null
}

/** Pendência com o contexto da tela de detalhe. */
export interface PendenciaDetalhe {
  registro: RegistroResumo
  pavimento: { codigo: string; nome: string }
  /** Papel do usuário na obra da pendência. */
  papel: PapelObra
  /** `null` enquanto a pendência está aberta. */
  encerramento: Encerramento | null
}

export interface NovoEncerramento {
  /** Id do encerramento (gerado no cliente, chave de idempotência). */
  id: string
  /** Id da pendência. */
  registroId: string
  obraId: string
  observacao: string
  /** Na ordem escolhida. */
  fotos: { id: string; largura: number; altura: number; bytes: number }[]
}

export interface Participante {
  usuario_id: string
  nome: string
  username: string | null
  papel: PapelObra
  desde: string
}

/** Publicação no Telegram que precisa de atenção do gestor. */
export interface PublicacaoProblema {
  id: number
  estado: EstadoPublicacao
  erro: string | null
  tentativas: number
  atualizado_em: string
  registro_id: string
  encerramento_id: string | null
  /** `encerramento` quando a publicação é a de um encerramento. */
  tipo: TipoRegistro | 'encerramento'
  legenda: string
  ambiente: string
}

/** Link de uso único para abrir o site de administração (vale 2 min). */
export interface LinkAdmin {
  url: string
  expira_em: string
}

/** Observação do dia na obra (RPC `observacoes_do_dia`). */
export interface Observacao {
  id: string
  /** Dia local (fuso da etapa), `AAAA-MM-DD`. */
  data: string
  texto: string
  /** Hora do aparelho em que foi escrita (ISO). */
  escrito_em: string
  editado_em: string | null
  /** `nome` já é o nome mostrado (de exibição ou do Telegram). */
  autor: { id: string; nome: string }
  /** Escrita pelo usuário da sessão. */
  minha: boolean
  /** O boletim do dia já foi emitido: não pode mais ser editada nem excluída. */
  travada: boolean
}

/** Observações de hoje na obra, com o dia e o fuso da etapa. */
export interface ObservacoesDoDia {
  /** Hoje no fuso da etapa, `AAAA-MM-DD`. */
  data: string
  /** Fuso IANA da etapa (para mostrar as horas). */
  fuso: string
  /** O boletim de hoje já foi emitido: nada mais entra nem muda. */
  travada: boolean
  /** Por `escrito_em`. */
  observacoes: Observacao[]
}

/** Etapa da tela inicial (`etapas_inicio`): todas as ativas, com a participação do usuário. */
export interface EtapaInicio {
  id: string
  slug: string
  nome: string
  ordem: number
  participa: boolean
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

/** Dados de `salvar_observacao`: id novo cria; id existente edita o texto (só o autor). */
export interface NovaObservacao {
  /** Gerado no aparelho (chave de idempotência). */
  id: string
  obraId: string
  texto: string
  /** ISO, hora do aparelho. */
  escritoEm: string
}

/** Pedido de emissão de hoje de uma etapa (`pendente`/`gerando`/`falhou`). */
export interface PedidoRelatorio {
  estado: string
  erro: string | null
}

/** Cartão "Hoje" de uma etapa na aba Relatórios. */
export interface EtapaRelatorio {
  id: string
  slug: string
  nome: string
  sigla: string | null
  /** Hora da emissão automática, `HH:MM`. */
  horario: string
  /** Hoje no fuso da etapa, `AAAA-MM-DD`. */
  hoje: string
  registros_hoje: number
  boletim_hoje: { id: string; numero: string; revisao: number; emitido_em: string } | null
  pedido_hoje: PedidoRelatorio | null
}

/** Boletim emitido (uma linha por revisão). A primeira revisão do dia é a 0. */
export interface BoletimRelatorio {
  id: string
  etapa_id: string
  etapa_slug: string
  etapa_nome: string
  data: string
  revisao: number
  numero: string
  emitido_em: string
  pdf_path: string | null
  publicado: boolean
  /** Última revisão do dia: só nela vale excluir (a exclusão apaga o dia inteiro). */
  ultima_revisao: boolean
}

/** Resposta de `listar_relatorios`. */
export interface Relatorios {
  admin: boolean
  etapas: EtapaRelatorio[]
  boletins: BoletimRelatorio[]
}

/** Obra da etapa no painel da aba Relatórios. */
export interface ObraPainel {
  id: string
  slug: string
  nome: string
}

/** Movimento de uma obra em um dia (no fuso da etapa). */
export interface DiaPainel {
  obra_id: string
  dia: string
  servicos: number
  pendencias: number
  resolvidas: number
}

/** Resposta de `painel_relatorios`. */
export interface PainelRelatorios {
  etapa: { id: string; slug: string; nome: string; hoje: string }
  obras: ObraPainel[]
  dias: DiaPainel[]
}

/** Resultado de excluir um boletim (o dia inteiro). */
export interface ResultadoExclusaoBoletim {
  numero: string
  data: string
  revisoes: number
  mensagens: { apagadas: number; falhas: number }
  arquivos_erro: string | null
}
