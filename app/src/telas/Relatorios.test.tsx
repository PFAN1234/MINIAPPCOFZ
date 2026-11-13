import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import type { EtapaRelatorio, Relatorios as DadosRelatorios } from '../dados/tipos.ts'
import * as telegram from '../telegram.ts'
import { renderizarApp } from '../test/renderApp.tsx'

afterEach(() => vi.restoreAllMocks())

/** Fixture com o cartão de hoje da 2ª etapa trocado. */
function comHoje(mudanca: Partial<EtapaRelatorio>, admin = false): Repositorio {
  const repo = criarRepositorioFixture({ admin })
  const original = repo.relatorios.bind(repo)
  repo.relatorios = async (): Promise<DadosRelatorios> => {
    const r = await original()
    return { ...r, etapas: r.etapas.map((e) => (e.slug === '2a-etapa' ? { ...e, ...mudanca } : e)) }
  }
  return repo
}

const cartao = () => screen.getByRole('article', { name: 'Hoje, 2ª ETAPA' })

describe('Relatórios', () => {
  it('abre na primeira etapa e troca pelas abas (na URL)', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/relatorios')
    expect(await screen.findByRole('heading', { name: 'Relatórios' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelectorAll('.relatorio-linha')).toHaveLength(3))
    expect(screen.getByRole('tab', { name: '2ª ETAPA' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('combobox', { name: 'Filtrar por etapa' })).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('tab', { name: /3ª ETAPA/ }))
    await waitFor(() => expect(document.querySelectorAll('.relatorio-linha')).toHaveLength(1))
    expect(screen.queryByRole('article', { name: 'Hoje, 2ª ETAPA' })).not.toBeInTheDocument()
    expect(await screen.findByText('Ainda não há registros nesta etapa.')).toBeInTheDocument()
  })

  it('lê a etapa da URL', async () => {
    renderizarApp('/relatorios?etapa=3a-etapa')
    await waitFor(() => expect(screen.getByRole('tab', { name: /3ª ETAPA/ })).toHaveAttribute('aria-selected', 'true'))
    expect(document.querySelectorAll('.relatorio-linha')).toHaveLength(1)
  })

  describe('painel', () => {
    it('mostra cartões, gráficos e tabela', async () => {
      renderizarApp('/relatorios')
      const grafico = await screen.findByRole('img', { name: /^Acumulado até/ })
      expect(grafico.getAttribute('aria-label')).toMatch(/\d+ serviços, \d+ pendências registradas, \d+ resolvidas/)
      expect(screen.getByText(/de \d+ registradas/)).toBeInTheDocument()
      expect(screen.getByText(/% das pendências/)).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'Pendências por obra' })).toBeInTheDocument()
      expect(screen.getByText('Ver em tabela')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Todas' })).toHaveAttribute('aria-selected', 'true')
    })

    it('filtra por obra (na URL) e esconde o gráfico por obra', async () => {
      const usuario = userEvent.setup()
      renderizarApp('/relatorios')
      await screen.findByRole('img', { name: /^Acumulado até/ })
      await usuario.click(screen.getByRole('tab', { name: 'Residencial Aurora' }))
      await waitFor(() => expect(screen.queryByRole('list', { name: 'Pendências por obra' })).not.toBeInTheDocument())
      expect(screen.getByText(/Obra Residencial Aurora/)).toBeInTheDocument()
    })

    it('lê a obra da URL', async () => {
      renderizarApp('/relatorios?etapa=2a-etapa&obra=hto')
      expect(await screen.findByText(/Obra HTO/)).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'HTO' })).toHaveAttribute('aria-selected', 'true')
    })

    it('tocar no gráfico mostra o dia e soltar esconde', async () => {
      renderizarApp('/relatorios')
      const grafico = await screen.findByRole('img', { name: /^Acumulado até/ })
      grafico.getBoundingClientRect = () => ({ left: 0, width: 320, top: 0, height: 190 }) as DOMRect
      fireEvent.pointerDown(grafico, { clientX: 160, pointerType: 'touch' })
      expect(await screen.findByText(/^\d\d\/\d\d · Serviços \d+ · Pendências \d+ · Resolvidas \d+$/)).toBeInTheDocument()
      fireEvent.pointerUp(grafico, { pointerType: 'touch' })
      await waitFor(() => expect(screen.queryByText(/ · Serviços \d+ ·/)).not.toBeInTheDocument())
    })

    it('setas do teclado percorrem os dias', async () => {
      renderizarApp('/relatorios')
      const grafico = await screen.findByRole('img', { name: /^Acumulado até/ })
      fireEvent.keyDown(grafico, { key: 'ArrowLeft' })
      expect(await screen.findByText(/ · Serviços \d+ ·/)).toBeInTheDocument()
    })
  })

  describe('exportar', () => {
    it('gera o PDF e abre o link', async () => {
      const usuario = userEvent.setup()
      const abrir = vi.spyOn(telegram, 'abrirLink').mockImplementation(() => {})
      renderizarApp('/relatorios')
      expect(await screen.findByText(/Todas as obras da 2ª ETAPA/)).toBeInTheDocument()
      await usuario.click(screen.getByRole('button', { name: 'Relatório de pendências (PDF)' }))
      expect(await screen.findByRole('button', { name: 'Gerando PDF…' })).toBeDisabled()
      await waitFor(() => expect(abrir).toHaveBeenCalledWith(expect.stringContaining('pendencias')), { timeout: 3000 })
    })

    it('erro vira alerta', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture()
      repo.exportarPendencias = async () => {
        throw new Error('Sem permissão para exportar')
      }
      renderizarApp('/relatorios', repo)
      await usuario.click(await screen.findByRole('button', { name: 'Relatório de pendências (PDF)' }))
      expect(await screen.findByText('Sem permissão para exportar')).toBeInTheDocument()
    })
  })

  it('sem boletins: mostra o vazio', async () => {
    const repo = criarRepositorioFixture()
    const original = repo.relatorios.bind(repo)
    repo.relatorios = async () => ({ ...(await original()), boletins: [] })
    renderizarApp('/relatorios', repo)
    expect(await screen.findByText('Nenhum boletim emitido ainda.')).toBeInTheDocument()
  })

  it('erro ao carregar usa o estado de erro', async () => {
    const repo = criarRepositorioFixture()
    repo.relatorios = async () => {
      throw new Error('falhou')
    }
    renderizarApp('/relatorios', repo)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  describe('cartão Hoje', () => {
    it('ainda não emitido', async () => {
      renderizarApp('/relatorios', comHoje({ boletim_hoje: null, pedido_hoje: null, registros_hoje: 3 }))
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      expect(within(cartao()).getByText('Ainda não emitido · sai automaticamente às 18:00')).toBeInTheDocument()
      expect(within(cartao()).getByText('3 registros hoje')).toBeInTheDocument()
    })

    it('registros: zero e singular', async () => {
      renderizarApp('/relatorios', comHoje({ registros_hoje: 0 }))
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      expect(within(cartao()).getByText('Nenhum registro hoje')).toBeInTheDocument()
    })

    it('emitido: número, hora e Abrir PDF', async () => {
      const repo = comHoje({
        boletim_hoje: { id: 'boletim-2a-etapa-hoje', numero: 'B-77', revisao: 0, emitido_em: '2026-11-13T21:05:00Z' },
      })
      const url = vi.spyOn(repo, 'urlPdfBoletim')
      const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
      renderizarApp('/relatorios', repo)
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      expect(within(cartao()).getByText('Boletim B-77 emitido às 18:05')).toBeInTheDocument()
      // sem linha na lista, o PDF do cartão fica indisponível
      expect(within(cartao()).getByRole('button', { name: 'Abrir PDF' })).toBeDisabled()
      expect(url).not.toHaveBeenCalled()
      expect(abrir).not.toHaveBeenCalled()
    })

    it('gerando e pendente: aviso e botão de emitir desabilitado para admin', async () => {
      renderizarApp('/relatorios', comHoje({ pedido_hoje: { estado: 'gerando', erro: null } }, true))
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      expect(within(cartao()).getByText('Gerando o boletim…')).toBeInTheDocument()
      expect(within(cartao()).getByRole('button', { name: 'Emitir agora' })).toBeDisabled()
    })

    it('falhou: mostra a falha e o erro', async () => {
      renderizarApp('/relatorios', comHoje({ pedido_hoje: { estado: 'falhou', erro: 'sem conexão' } }))
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      expect(within(cartao()).getByText('A emissão falhou: sem conexão')).toBeInTheDocument()
    })
  })

  describe('abrir PDF', () => {
    it('pede a URL assinada e abre em aba nova fora do Telegram', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture()
      const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
      renderizarApp('/relatorios', repo)
      const botoes = await screen.findAllByRole('button', { name: /^Abrir PDF do boletim/ })
      await usuario.click(botoes[0])
      await waitFor(() => expect(abrir).toHaveBeenCalledWith(expect.stringContaining('/boletins/'), '_blank', 'noopener'))
    })

    it('erro ao assinar vira aviso na tela', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture()
      repo.urlPdfBoletim = async () => {
        throw new Error('Sem permissão.')
      }
      renderizarApp('/relatorios', repo)
      const botoes = await screen.findAllByRole('button', { name: /^Abrir PDF do boletim/ })
      await usuario.click(botoes[0])
      expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão.')
    })
  })

  describe('admin', () => {
    it('não-admin não vê Emitir nem Excluir', async () => {
      renderizarApp('/relatorios', criarRepositorioFixture({ admin: false }))
      await screen.findAllByRole('button', { name: /^Abrir PDF/ })
      expect(screen.queryByRole('button', { name: /Emitir/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
    })

    it('admin vê Emitir e Excluir só na última revisão do dia', async () => {
      renderizarApp('/relatorios', criarRepositorioFixture({ admin: true }))
      await screen.findAllByRole('button', { name: /^Abrir PDF/ })
      expect(screen.getAllByRole('button', { name: 'Emitir agora' })).toHaveLength(1)
      // 3 boletins da etapa, 2 são última revisão do dia (o dia com retificação tem 2 linhas)
      expect(screen.getAllByRole('button', { name: /^Excluir o boletim/ })).toHaveLength(2)
    })

    it('Emitir agora: cancelar não chama; confirmar chama com a etapa e o dia', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture({ admin: true })
      const emitir = vi.spyOn(repo, 'emitirBoletim')
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderizarApp('/relatorios', repo)
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      await usuario.click(within(cartao()).getByRole('button', { name: 'Emitir agora' }))
      expect(confirmar).toHaveBeenCalledWith(
        expect.stringMatching(/^Emitir agora o boletim de \d\d\/\d\d da 2ª ETAPA\? Ele será publicado no grupo do Telegram\.$/),
      )
      expect(emitir).not.toHaveBeenCalled()

      confirmar.mockReturnValue(true)
      await usuario.click(within(cartao()).getByRole('button', { name: 'Emitir agora' }))
      await waitFor(() => expect(emitir).toHaveBeenCalledWith('2a-etapa', expect.stringMatching(/^\d{4}-\d\d-\d\d$/)))
      // depois de emitir, o cartão passa a oferecer revisão
      expect(await within(cartao()).findByRole('button', { name: 'Emitir revisão' })).toBeInTheDocument()
      await usuario.click(within(cartao()).getByRole('button', { name: 'Emitir revisão' }))
      expect(confirmar).toHaveBeenLastCalledWith(expect.stringContaining('Será uma nova revisão, publicada no grupo do Telegram.'))
    })

    it('erro ao emitir aparece na tela', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture({ admin: true })
      repo.emitirBoletim = async () => {
        throw new Error('Já existe uma emissão em andamento para esta data.')
      }
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderizarApp('/relatorios', repo)
      await screen.findByRole('article', { name: 'Hoje, 2ª ETAPA' })
      await usuario.click(within(cartao()).getByRole('button', { name: 'Emitir agora' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma emissão em andamento')
    })

    it('Excluir: cancelar não chama', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture({ admin: true })
      const excluir = vi.spyOn(repo, 'excluirBoletim')
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderizarApp('/relatorios', repo)
      const botoes = await screen.findAllByRole('button', { name: /^Excluir o boletim/ })
      await usuario.click(botoes[0])
      expect(excluir).not.toHaveBeenCalled()
    })

    it('Excluir: confirmar remove o dia e mostra o aviso', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture({ admin: true })
      const excluir = vi.spyOn(repo, 'excluirBoletim')
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderizarApp('/relatorios', repo)
      const botoes = await screen.findAllByRole('button', { name: /^Excluir o boletim/ })
      const antes = document.querySelectorAll('.relatorio-linha').length
      await usuario.click(botoes[0])
      expect(confirmar).toHaveBeenCalledWith(
        expect.stringMatching(/^Excluir o boletim .+\? Sai o dia \d\d\/\d\d\/\d{4} inteiro, com as revisões, os PDFs e a mensagem no grupo do Telegram\. Não dá para desfazer\.$/),
      )
      expect(excluir).toHaveBeenCalledTimes(1)
      expect(await screen.findByRole('status')).toHaveTextContent('excluído. A mensagem foi apagada do grupo.')
      await waitFor(() => expect(document.querySelectorAll('.relatorio-linha').length).toBeLessThan(antes))
    })

    it('Excluir: falha ao apagar a mensagem e PDFs com erro', async () => {
      const usuario = userEvent.setup()
      const repo = criarRepositorioFixture({ admin: true })
      repo.excluirBoletim = async () => ({
        numero: 'X-1',
        data: '2026-11-12',
        revisoes: 1,
        mensagens: { apagadas: 0, falhas: 1 },
        arquivos_erro: 'storage fora',
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderizarApp('/relatorios', repo)
      const botoes = await screen.findAllByRole('button', { name: /^Excluir o boletim/ })
      await usuario.click(botoes[0])
      const aviso = await screen.findByRole('status')
      expect(aviso).toHaveTextContent('só permite apagar até 48 h depois do envio')
      expect(aviso).toHaveTextContent('Os PDFs não foram removidos do armazenamento.')
    })
  })
})
