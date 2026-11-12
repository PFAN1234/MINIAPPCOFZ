/// <reference lib="webworker" />
/**
 * Web Worker do site de administração: converte um IFC em `.frag` com o `IfcImporter` da
 * That Open (o mesmo do script `ifc_para_frag.mjs`), sem travar a página. O IFC é lido em
 * blocos de 1 MB direto do arquivo (`FileReaderSync`), sem copiar tudo para a memória do JS.
 */
import { IfcImporter } from '@thatopen/fragments'
import type { MensagemConversor, PedidoConversao } from './conversor.ts'

const BLOCO = 1024 * 1024

function enviar(m: MensagemConversor, transferir: Transferable[] = []) {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transferir)
}

self.onmessage = async (ev: MessageEvent<PedidoConversao>) => {
  const { arquivo, wasm } = ev.data
  try {
    const leitor = new FileReaderSync()
    const importador = new IfcImporter()
    importador.wasm = { path: wasm, absolute: true }
    const frag = await importador.process({
      readFromCallback: true,
      readCallback: (inicio: number) => new Uint8Array(leitor.readAsArrayBuffer(arquivo.slice(inicio, inicio + BLOCO))),
      progressCallback: (fracao: number, dados: { process?: string; state?: string }) =>
        enviar({
          tipo: 'progresso',
          fracao,
          etapa: dados.process ?? '',
          estado: dados.state ?? '',
        }),
    })
    enviar({ tipo: 'pronto', frag }, [frag.buffer])
  } catch (e) {
    enviar({
      tipo: 'erro',
      mensagem: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    })
  }
}
