/** Tipos do domínio de operação (telemetria de erros do cliente e varredura de arquivos órfãos). */

export interface ErroCliente {
  id: number
  criado_em: string
  usuario_id: string | null
  usuario_nome: string | null
  app: 'miniapp' | 'admin'
  versao: string | null
  rota: string | null
  mensagem: string
  pilha: string | null
  agente: string | null
  contexto: Record<string, unknown> | null
}

export interface ResumoOrfaoBucket {
  bucket: string
  quantidade: number
  bytes: number
}

export interface ArquivoOrfao {
  bucket: string
  caminho: string
  tamanho: number | null
  criado_em: string | null
  detectado_em: string
}

/** RPC `admin_resumo_orfaos`: simulação da varredura de arquivos sem referência no banco. */
export interface ResumoOrfaos {
  buckets: ResumoOrfaoBucket[]
  maiores: ArquivoOrfao[]
}
