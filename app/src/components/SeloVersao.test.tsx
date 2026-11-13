import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SeloVersao, detalheVersao, rotuloVersao } from './SeloVersao.tsx'

// 13/11/2026 14:32 em Brasília (UTC−3).
const DATA = '2026-11-13T17:32:00.000Z'

describe('versão do app', () => {
  it('vPR.aammdd.commit', () => {
    expect(rotuloVersao({ pr: 39, commit: '9e969c1', data: DATA })).toBe('v39.261113.9e969c1')
  })

  it('a data segue o fuso de Brasília (00:30 UTC ainda é o dia anterior)', () => {
    expect(rotuloVersao({ pr: 39, commit: '9e969c1', data: '2026-11-14T00:30:00.000Z' })).toBe('v39.261113.9e969c1')
  })

  it('sem PR, "vdev"; sem commit, fica sem a última parte', () => {
    expect(rotuloVersao({ pr: null, commit: 'abc1234', data: DATA })).toBe('vdev.261113.abc1234')
    expect(rotuloVersao({ pr: 39, commit: null, data: DATA })).toBe('v39.261113')
  })

  it('o detalhe traz a versão e a data e hora da publicação', () => {
    expect(detalheVersao({ pr: 39, commit: '9e969c1', data: DATA })).toEqual([
      'v39.261113.9e969c1',
      'Publicada em 13/11/2026 14:32',
    ])
  })

  it('um toque abre o detalhe e outro fecha', async () => {
    render(<SeloVersao versao={{ pr: 39, commit: '9e969c1', data: DATA }} />)
    const botao = screen.getByRole('button', { name: 'Versão do app: v39.261113.9e969c1' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(botao)
    expect(botao).toHaveTextContent('v39.261113.9e969c1Publicada em 13/11/2026 14:32')
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(botao)
    expect(botao).toHaveTextContent(/^v39\.261113\.9e969c1$/)
  })

  it('sem versão explícita, usa a do build', () => {
    render(<SeloVersao />)
    expect(screen.getByRole('button', { name: /^Versão do app: / })).toBeInTheDocument()
  })
})
