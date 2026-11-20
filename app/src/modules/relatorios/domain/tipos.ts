/** Tipos do domínio de relatórios, painel e observações do dia (Mini App). */

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
  /** Quantas revisões (boletins) do dia foram apagadas. */
  revisoes: number
  mensagens: { apagadas: number; falhas: number }
  /** Os PDFs não saíram do armazenamento (texto do erro). */
  arquivos_erro: string | null
}
