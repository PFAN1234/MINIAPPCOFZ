/** Conversão de IFC em `.frag` (no navegador, por um Web Worker). */
export interface PedidoConversao {
  arquivo: Blob
  /** Pasta (URL absoluta, com barra no fim) onde está o `web-ifc.wasm`. */
  wasm: string
}

export type MensagemConversor =
  | { tipo: 'progresso'; fracao: number; etapa: string; estado: string }
  | { tipo: 'pronto'; frag: Uint8Array }
  | { tipo: 'erro'; mensagem: string }

export interface ProgressoConversao {
  /** 0 a 1. */
  fracao: number
  texto: string
}

export interface Conversor {
  converter(arquivo: Blob, aoProgredir: (p: ProgressoConversao) => void, sinal?: AbortSignal): Promise<Uint8Array>
}
