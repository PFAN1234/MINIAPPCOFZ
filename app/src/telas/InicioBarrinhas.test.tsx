import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import type { ResumoObra } from '../dados/tipos.ts'
import { renderizarApp } from '../test/renderApp.tsx'
import { textoPendenciasResolvidas, textoServicos } from '../util/formato.ts'

const ID_HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'

function repoComResumo(resumo: ResumoObra[] | Error): Repositorio {
  return {
    ...criarRepositorioFixture(),
    resumoObras: async () => {
      if (resumo instanceof Error) throw resumo
      return resumo
    },
  }
}

async function linhaDaHto() {
  const link = await screen.findByRole('link', { name: 'HTO' })
  return link.closest('li') as HTMLElement
}

describe('Início: textos por extenso', () => {
  it('singular e plural', () => {
    expect(textoServicos(1)).toBe('1 serviço')
    expect(textoServicos(0)).toBe('0 serviços')
    expect(textoPendenciasResolvidas(1)).toBe('1 pendência resolvida')
    expect(textoPendenciasResolvidas(2)).toBe('2 pendências resolvidas')
  })
})

describe('Início: abas ao lado do título', () => {
  it('o título e as abas ficam na mesma linha', async () => {
    renderizarApp('/')
    const abas = await screen.findByRole('tablist', { name: 'Etapa' })
    const titulo = screen.getByRole('heading', { level: 1, name: 'Obras' })
    expect(titulo.parentElement).toBe(abas.parentElement?.parentElement)
    expect(titulo.parentElement).toHaveClass('topo-linha-titulo')
  })
})

describe('Início: barrinhas', () => {
  it('mostra as 3 barrinhas com número e descrição por extenso, e some o selo antigo', async () => {
    renderizarApp('/')
    const linha = await linhaDaHto()
    const s = await within(linha).findByRole('img', { name: '2 serviços' })
    expect(s).toHaveTextContent('2')
    expect(s).toHaveAttribute('title', '2 serviços')
    expect(within(linha).getByRole('img', { name: '3 pendências abertas' })).toHaveTextContent('3')
    expect(within(linha).getByRole('img', { name: '1 pendência resolvida' })).toHaveTextContent('1')
    expect(screen.queryByText('3 pendências abertas', { selector: '.selo' })).not.toBeInTheDocument()
  })

  it('as 3 aparecem mesmo com zeros', async () => {
    renderizarApp('/')
    const aurora = (await screen.findByRole('link', { name: 'Residencial Aurora' })).closest('li') as HTMLElement
    expect(await within(aurora).findByRole('img', { name: '0 serviços' })).toBeInTheDocument()
    expect(within(aurora).getByRole('img', { name: '0 pendências abertas' })).toBeInTheDocument()
    expect(within(aurora).getByRole('img', { name: '0 pendências resolvidas' })).toBeInTheDocument()
  })

  it('singular com 1', async () => {
    renderizarApp(
      '/',
      repoComResumo([{ obra_id: ID_HTO, papel: 'equipe', servicos: 1, abertas: 1, resolvidas: 1 }]),
    )
    const linha = await linhaDaHto()
    expect(await within(linha).findByRole('img', { name: '1 serviço' })).toBeInTheDocument()
    expect(within(linha).getByRole('img', { name: '1 pendência aberta' })).toBeInTheDocument()
  })

  it('sem dados do resumo, as barrinhas não aparecem', async () => {
    renderizarApp('/', repoComResumo(new Error('sem sinal')))
    const linha = await linhaDaHto()
    expect(within(linha).queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('Início: botão Gestão', () => {
  it('aparece só nas obras em que o usuário é gestor, como link irmão do link da obra', async () => {
    renderizarApp('/')
    const linha = await linhaDaHto()
    const gestao = await within(linha).findByRole('link', { name: /Gestão/ })
    expect(gestao).toHaveAttribute('href', '/obras/hto/gestao')
    expect(gestao.closest('a')?.parentElement).toBe(linha)
    expect(screen.getByRole('link', { name: 'HTO' })).not.toContainElement(gestao)
    expect(screen.getAllByRole('link', { name: /Gestão/ })).toHaveLength(1)
  })

  it('mostra o selo de alerta com pedidos e publicações com problema', async () => {
    renderizarApp('/')
    const linha = await linhaDaHto()
    expect(await within(linha).findByRole('link', { name: 'Gestão 3' })).toBeInTheDocument()
  })

  it('equipe não vê o botão', async () => {
    renderizarApp(
      '/',
      repoComResumo([{ obra_id: ID_HTO, papel: 'equipe', servicos: 0, abertas: 0, resolvidas: 0 }]),
    )
    await linhaDaHto()
    expect(screen.queryByRole('link', { name: /Gestão/ })).not.toBeInTheDocument()
  })
})
