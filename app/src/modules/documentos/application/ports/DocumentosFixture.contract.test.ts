import { criarDocumentosFixture } from '../../infra/DocumentosFixtureAdapter.ts'
import { contratoDocumentosRepositorio } from './DocumentosRepositorio.contract.ts'

contratoDocumentosRepositorio('fixture', () => {
  const arquivos = new Map<string, Uint8Array>()
  return {
    repo: criarDocumentosFixture({
      tamanhoArquivo: (c) => arquivos.get(c)?.byteLength,
      conteudoArquivo: (c) => arquivos.get(c),
    }),
    depositar: (caminho, conteudo) => arquivos.set(caminho, conteudo),
    obraId: 'obra-hto',
  }
})
