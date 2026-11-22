import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import { ErroEnvio } from '../../../dados/erros.ts'

/** Armazenamento em memória (fixture e testes), com estado próprio por instância. */
export function criarArmazenamentoFixture(): Armazenamento {
  const arquivos = new Map<string, Blob>()
  const chave = (pasta: string, caminho: string) => `${pasta}/${caminho}`

  return {
    async enviar(pasta, caminho, dados) {
      const k = chave(pasta, caminho)
      if (arquivos.has(k)) return 'ja_confirmado'
      arquivos.set(k, dados)
      return 'enviado'
    },
    async urls(pasta, caminhos) {
      const mapa = new Map<string, string>()
      for (const c of new Set(caminhos)) {
        if (arquivos.has(chave(pasta, c))) mapa.set(c, `/__armazenamento/${chave(pasta, c)}`)
      }
      return mapa
    },
    async baixar(pasta, caminho) {
      const blob = arquivos.get(chave(pasta, caminho))
      if (!blob) throw new ErroEnvio('nao_encontrado', 'Arquivo não encontrado.')
      return blob
    },
    async excluir(pasta, caminho) {
      arquivos.delete(chave(pasta, caminho))
    },
  }
}
