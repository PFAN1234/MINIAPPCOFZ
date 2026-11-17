import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import type { Ambiente } from '../dados/tipos.ts'
import { renderizarApp } from '../test/renderApp.tsx'

const AVISO = 'Este ambiente não existe na planta atual; registros mantidos como histórico.'

/** Fixture em que o ambiente `codigo` saiu da planta (inativo e sem detalhe na planta ativa). */
function comInativo(codigo: string): Repositorio {
  const base = criarRepositorioFixture()
  const marcar = (a: Ambiente): Ambiente => (a.codigo === codigo ? { ...a, ativo: false } : a)
  return {
    ...base,
    async obterObra(slug) {
      const obra = await base.obterObra(slug)
      return { ...obra, ambientes: obra.ambientes.map(marcar) }
    },
    async obterAmbiente(slug, c) {
      const d = await base.obterAmbiente(slug, c)
      return c === codigo ? { ...d, ambiente: marcar(d.ambiente), detalhe: null } : d
    },
  }
}

describe('ambiente inativo (saiu da planta numa revisão)', () => {
  it('a tela abre com o aviso, sem "Onde fica", e mantém o histórico', async () => {
    renderizarApp('/obras/hto/ambientes/terreo-apto-101', comInativo('terreo-apto-101'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apto. 101' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(AVISO)
    expect(screen.queryByText('Onde fica')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Contrapiso do quarto concluído e curado.'),
    ).toBeInTheDocument()
  })

  it('ambiente ativo não mostra o aviso', async () => {
    renderizarApp('/obras/hto/ambientes/terreo-apto-101')
    expect(await screen.findByRole('heading', { level: 1, name: 'Apto. 101' })).toBeInTheDocument()
    expect(await screen.findByText('Onde fica')).toBeInTheDocument()
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument()
  })

  it('a lista da obra não mostra o inativo, mas a contagem de pendências o inclui', async () => {
    renderizarApp('/obras/hto?aba=lista&q=101', comInativo('terreo-apto-101'))
    expect(await screen.findByRole('link', { name: /Banheiro 101/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Apto\. 101/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Pendências\s*3$/ })).toBeInTheDocument()
  })

  it('ambiente inativo não libera Comparar com o modelo (RA) no Novo registro', async () => {
    const base = comInativo('terreo-apto-101')
    const modelosChamados = new Promise<void>((resolve) => {
      const repo: Repositorio = {
        ...base,
        listarModelos: async () => {
          resolve()
          return [{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'h' }]
        },
      }
      renderizarApp('/obras/hto/ambientes/terreo-apto-101/novo?ra=1', repo)
    })
    await screen.findByLabelText('Legenda')
    await Promise.race([modelosChamados, new Promise((r) => setTimeout(r, 30))])
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: 'Comparar com o modelo (RA)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Comparar com o modelo' })).not.toBeInTheDocument()
  })
})
