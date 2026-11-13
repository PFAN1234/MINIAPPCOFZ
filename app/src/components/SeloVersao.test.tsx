import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SeloVersao, detalheVersao, rotuloVersao } from './SeloVersao.tsx'

// 13/11/2026 14:32 em Brasília (UTC−3).
const DATA = '2026-11-13T17:32:00.000Z'

describe('versão do app', () => {
  it('mostra o número do PR e o dia do build', () => {
    expect(rotuloVersao({ pr: 39, commit: '9e969c1', data: DATA })).toBe('v39 · 13/11')
  })

  it('sem PR, mostra o commit curto; sem commit, "dev"', () => {
    expect(rotuloVersao({ pr: null, commit: 'abc1234', data: DATA })).toBe('abc1234 · 13/11')
    expect(rotuloVersao({ pr: null, commit: null, data: DATA })).toBe('dev · 13/11')
  })

  it('o detalhe traz o commit, a data e a hora no fuso de Brasília', () => {
    expect(detalheVersao({ pr: 39, commit: '9e969c1', data: DATA })).toEqual(['Versão 39 · commit 9e969c1', '13/11/2026 14:32'])
  })

  it('um toque abre o detalhe e outro fecha', async () => {
    render(<SeloVersao versao={{ pr: 39, commit: '9e969c1', data: DATA }} />)
    const botao = screen.getByRole('button', { name: 'Versão do app: v39 · 13/11' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(botao)
    expect(botao).toHaveTextContent('Versão 39 · commit 9e969c113/11/2026 14:32')
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(botao)
    expect(botao).toHaveTextContent('v39 · 13/11')
  })

  it('sem versão explícita, usa a do build', () => {
    render(<SeloVersao />)
    expect(screen.getByRole('button', { name: /^Versão do app: / })).toBeInTheDocument()
  })
})
