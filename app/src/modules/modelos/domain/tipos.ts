/** Modelo 3D (.frag) publicado de uma disciplina (tabela `modelo`). */
export interface ModeloAdmin {
  sigla: string
  revisao: string | null
  caminho: string
  bytes: number
  hash: string
  atualizado_em: string
}

/** Linha do histórico de modelos (`publicacao_modelo`). */
export interface EventoModelo {
  id: string
  acao: 'publicado' | 'retirado'
  sigla: string
  revisao: string | null
  bytes: number | null
  hash: string | null
  origem: 'ifc' | 'frag' | null
  arquivo_nome: string | null
  ifc_bytes: number | null
  publicado_em: string
  publicado_por_nome: string | null
}

export interface DadosModelos {
  modelos: ModeloAdmin[]
  historico: EventoModelo[]
}

/** Payload da RPC `admin_registrar_modelo` (o arquivo já está no bucket `modelos`). */
export interface RegistroModelo {
  sigla: string
  revisao: string | null
  caminho: string
  bytes: number
  hash: string
  origem: 'ifc' | 'frag'
  arquivo_nome?: string | null
  ifc_bytes?: number | null
}
