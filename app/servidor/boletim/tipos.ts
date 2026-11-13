/**
 * Snapshot do boletim (`boletim_snapshot` / `admin_boletim_snapshot`), como em
 * docs/contrato-boletim.md (parte 3). Datas no fuso da etapa ("AAAA-MM-DD"), instantes em ISO,
 * nomes já no formato de exibição. O gerador só preenche `clima`.
 */
import type { Edicao } from './edicao.js'

export interface FotoSnapshot {
  /** Caminho no bucket `fotos`. */
  path: string
  largura: number
  altura: number
}

/** Serviço do dia ou pendência aberta no dia. */
export interface RegistroSnapshot {
  id: string
  pavimento: string
  ambiente: string
  /** "HH:MM" no fuso da etapa (ou instante ISO). */
  hora: string
  autor: string
  legenda: string | null
  fotos: FotoSnapshot[]
}

export interface PendenciaEncerradaSnapshot {
  id: string
  pavimento: string
  ambiente: string
  /** Data ("AAAA-MM-DD") ou instante ISO da abertura. */
  aberta_em: string
  dias_aberta: number
  legenda: string | null
  fotos_registro: FotoSnapshot[]
  encerramento: { hora: string; autor: string; observacao: string | null; fotos: FotoSnapshot[] }
}

export interface ObservacaoSnapshot {
  hora: string
  autor: string
  texto: string
  editada: boolean
}

export interface ObraSnapshot {
  id: string
  nome: string
  slug: string
  servicos: RegistroSnapshot[]
  pendencias_abertas: RegistroSnapshot[]
  pendencias_encerradas: PendenciaEncerradaSnapshot[]
  observacoes: ObservacaoSnapshot[]
}

export interface TardioSnapshot {
  id: string
  tipo: 'servico' | 'pendencia' | 'encerramento' | 'observacao'
  /** Dia do lançamento ("AAAA-MM-DD") e hora "HH:MM" no fuso da etapa. */
  data: string
  hora: string | null
  /** Quando o servidor recebeu (ISO). */
  recebido_em: string | null
  obra: string
  ambiente: string | null
  autor: string
  texto: string | null
}

export interface AditivoSnapshot {
  numero: string
  data: string
  prazo_dias: number
  valor: number
  descricao: string | null
}

export interface PrazoSnapshot {
  termino_original: string
  prazo_aditivos_dias: number
  termino_atual: string
  valor_atual: number | null
  dias_decorridos: number
  dias_totais: number
  /** 0–100 (null sem prazo total). */
  percentual: number | null
  dias_restantes: number
}

export interface EtapaSnapshot {
  id: string
  slug: string
  nome: string
  sigla: string | null
  endereco: string | null
  latitude: number | null
  longitude: number | null
  fuso: string
  estacao: string | null
  estacao_reserva: string | null
  boletim_horario: string
  objeto: string | null
  local: string | null
  contratante: string | null
  contrato: string | null
  contratada: string | null
  contratada_cnpj: string | null
  os_numero: string | null
  os_data: string | null
  vigencia_meses: number | null
  valor_original: number | null
  area_construida_m2: number | null
  aditivos: AditivoSnapshot[]
  prazo: PrazoSnapshot | null
  [outro: string]: unknown
}

export interface IndicadoresSnapshot {
  pendencias: {
    abertas_inicio: number
    abertas_no_dia: number
    encerradas_no_dia: number
    abertas_fim: number
    total_abertas: number
    total_encerradas: number
    /** 0–100; null sem pendências. */
    taxa_resolucao: number | null
    mais_7: number
    mais_15: number
    mais_30: number
    tempo_medio_resolucao_dias: number | null
  }
  atividade: { registros_servico: number; fotos: number; ambientes: number; pessoas: number }
  por_obra: { obra: string; servicos: number; abertas_no_dia: number; encerradas_no_dia: number; abertas_fim: number; mais_15: number }[]
}

/** O que o gerador grava em `clima`. */
export type ClimaComDados = {
  fonte: string
  estacao: { codigo: string; nome: string }
  /** "HH:MM" da leitura no fuso de Fortaleza (null se a página não disser). */
  leitura: string | null
  copiado_em: string
  /** Caminho da imagem no bucket `boletins` (null na prévia, que não grava nada). */
  imagem_path: string | null
  /** Número do boletim de onde o clima foi reaproveitado (retificação de dia antigo). */
  reaproveitado_de?: string
}

export type ClimaSnapshot =
  | ClimaComDados
  | { indisponivel: true; motivo: string }

export interface Snapshot {
  versao: number
  data: string
  /** Quando o banco montou o snapshot (ISO). */
  gerado_em?: string
  fuso: string
  organizacao: { nome: string; cabecalho: string[]; logo_path: string | null }
  etapa: EtapaSnapshot
  responsaveis: { nome: string; funcao: string }[]
  indicadores: IndicadoresSnapshot
  obras: ObraSnapshot[]
  tardios: TardioSnapshot[]
  clima: ClimaSnapshot | null
}

/** Pedido reivindicado da fila (`reivindicar_emissoes`). */
export interface PedidoReivindicado {
  id: number
  etapa_id: string
  data: string
  revisao: number
  numero: string
  /** Boletim emitido que está sendo retificado (null = emissão normal). */
  base_boletim_id: string | null
  edicao: Edicao | null
}
