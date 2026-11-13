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

describe('Início: abas de etapa na base do topo', () => {
  it('as abas ficam no mesmo cabeçalho do título, na linha da base', async () => {
    renderizarApp('/')
    const abas = await screen.findByRole('tablist', { name: 'Etapa' })
    const titulo = screen.getByRole('heading', { level: 1, name: 'Obras' })
    expect(abas.parentElement).toHaveClass('topo-base')
    expect(titulo.closest('header')).toBe(abas.closest('header'))
    expect(titulo.closest('header')!.lastElementChild).toBe(abas.parentElement)
  })
})

describe('Início: barrinhas', () => {
  it('mostra os 3 totais com número, rótulo curto e descrição por extenso, e some o selo antigo', async () => {
    renderizarApp('/')
    const linha = await linhaDaHto()
    const s = await within(linha).findByRole('img', { name: '2 serviços' })
    expect(s).toHaveTextContent(/^2Serviços$/)
    expect(s).toHaveAttribute('title', '2 serviços')
    expect(within(linha).getByRole('img', { name: '3 pendências abertas' })).toHaveTextContent(/^3Pendências$/)
    expect(within(linha).getByRole('img', { name: '1 pendência resolvida' })).toHaveTextContent(/^1Resolvidas$/)
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
    expect(gestao.parentElement).toBe(screen.getByRole('link', { name: 'HTO' }).parentElement)
    expect(linha).toContainElement(gestao)
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
