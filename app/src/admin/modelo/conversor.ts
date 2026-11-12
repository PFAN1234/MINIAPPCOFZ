/**
 * Conversão de IFC em `.frag` no navegador do admin, num Web Worker (`conversor.worker.ts`).
 * Nos testes, um conversor falso entra pelo `ConversorProvider`.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react'

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

const ETAPAS: Record<string, string> = {
  conversion: 'Convertendo',
  geometries: 'Lendo as geometrias',
  attributes: 'Lendo os atributos',
  relations: 'Lendo as relações',
  properties: 'Lendo as propriedades',
}

export function textoEtapa(etapa: string): string {
  return ETAPAS[etapa] ?? 'Convertendo'
}

/** Mensagem para a tela; falta de memória vira a orientação de usar o script. */
export function mensagemErroConversao(bruta: string): string {
  if (/memory|out of bounds|allocation|RangeError/i.test(bruta)) {
    return (
      'A conversão ficou sem memória neste navegador (IFC grande demais para a aba). Converta no computador com ' +
      '`npm run modelos` (ver docs/admin.md) e envie o .frag pronto.'
    )
  }
  return `Não foi possível converter o IFC: ${bruta}`
}

export function pastaWasm(origem: string = location.origin): string {
  return `${origem}/web-ifc/${__VERSAO_WEB_IFC__}/`
}

export function criarConversorNavegador(): Conversor {
  return {
    converter(arquivo, aoProgredir, sinal) {
      return new Promise((resolver, rejeitar) => {
        const worker = new Worker(new URL('./conversor.worker.ts', import.meta.url), { type: 'module' })
        const encerrar = () => worker.terminate()
        sinal?.addEventListener('abort', () => {
          encerrar()
          rejeitar(new DOMException('Conversão cancelada.', 'AbortError'))
        })
        worker.onmessage = (ev: MessageEvent<MensagemConversor>) => {
          const m = ev.data
          if (m.tipo === 'progresso') aoProgredir({ fracao: m.fracao, texto: textoEtapa(m.etapa) })
          else if (m.tipo === 'pronto') {
            encerrar()
            resolver(m.frag)
          } else {
            encerrar()
            rejeitar(new Error(mensagemErroConversao(m.mensagem)))
          }
        }
        worker.onerror = (ev) => {
          encerrar()
          rejeitar(new Error(mensagemErroConversao(ev.message || 'erro no worker')))
        }
        worker.postMessage({
          arquivo,
          wasm: pastaWasm(),
        } satisfies PedidoConversao)
      })
    },
  }
}

const ContextoConversor = createContext<Conversor | null>(null)

export function ConversorProvider({ conversor, children }: { conversor: Conversor; children: ReactNode }) {
  return createElement(ContextoConversor.Provider, { value: conversor }, children)
}

let padrao: Conversor | null = null

export function useConversor(): Conversor {
  const c = useContext(ContextoConversor)
  if (c) return c
  padrao ??= criarConversorNavegador()
  return padrao
}
