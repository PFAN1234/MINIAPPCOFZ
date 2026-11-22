import { criarIssuesFixture } from '../../infra/IssuesFixtureAdapter.ts'
import { sementeIssuesHto } from '../../infra/issuesSemente.ts'
import { contratoIssuesRepositorio } from './IssuesRepositorio.contract.ts'

contratoIssuesRepositorio('fixture', () => {
  const arquivos = new Set<string>()
  return {
    repo: criarIssuesFixture({ tamanhoArquivo: (c) => (arquivos.has(c) ? 3 : undefined) }),
    depositar: (caminho) => void arquivos.add(caminho),
    obraId: 'obra-hto',
  }
})

contratoIssuesRepositorio('fixture (com semente em outra obra)', () => {
  const arquivos = new Set<string>()
  return {
    repo: criarIssuesFixture({
      tamanhoArquivo: (c) => (arquivos.has(c) ? 3 : undefined),
      semente: [{ obraId: 'obra-hto', issues: sementeIssuesHto() }],
    }),
    depositar: (caminho) => void arquivos.add(caminho),
    obraId: 'obra-cofz',
  }
})
