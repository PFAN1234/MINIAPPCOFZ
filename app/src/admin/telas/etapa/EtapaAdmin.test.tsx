import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import type { RepositorioAdmin } from '../../dados/repositorio.ts'
import { criarEntrada } from '../../entrada.ts'

function renderizar(rota: string, repo: RepositorioAdmin = criarRepositorioAdminFixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <MemoryRouter initialEntries={[rota]}>
          <AdminApp entrada={criarEntrada(null)} />
        </MemoryRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return repo
}

describe('etapas (fixture)', () => {
  it('a tela inicial mostra cada etapa ativa com as obras dela', async () => {
    renderizar('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Etapas' })).toBeInTheDocument()
    const segunda = await screen.findByRole('region', { name: '2ª ETAPA' })
    const tabela = within(segunda).getByRole('table', { name: 'Obras de 2ª ETAPA' })
    expect(within(tabela).getByRole('link', { name: 'HTO' })).toBeInTheDocument()
    expect(within(tabela).getByRole('link', { name: 'COFZ' })).toBeInTheDocument()
    expect(segunda).toHaveTextContent('Grupo do Telegram: Fiscalização 2ª ETAPA')
    const terceira = screen.getByRole('region', { name: '3ª ETAPA' })
    expect(terceira).toHaveTextContent('Nenhuma obra ativa nesta etapa.')
    expect(within(terceira).getByRole('link', { name: 'Nova obra em 3ª ETAPA' })).toHaveAttribute(
      'href',
      '/nova-obra?etapa=3a-etapa',
    )
  })

  it('cria etapa: valida slug, sigla e coordenadas, recusa sigla repetida e abre a página com a instrução do Telegram', async () => {
    const user = userEvent.setup()
    renderizar('/')
    await user.click(await screen.findByRole('link', { name: 'Nova etapa' }))
    await user.type(screen.getByLabelText('Slug'), '4ª etapa')
    await user.type(screen.getByLabelText('Nome'), '4ª ETAPA')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Slug inválido')
    await user.clear(screen.getByLabelText('Slug'))
    await user.type(screen.getByLabelText('Slug'), '2a-etapa')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe a sigla da etapa')
    await user.type(screen.getByLabelText('Sigla'), '2')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe a latitude e a longitude')
    await user.click(screen.getByLabelText('Latitude'))
    await user.paste('−3.7610, −38.5297')
    expect(screen.getByLabelText('Latitude')).toHaveValue('-3,761')
    expect(screen.getByLabelText('Longitude')).toHaveValue('-38,5297')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma etapa com o slug 2a-etapa')
    await user.clear(screen.getByLabelText('Slug'))
    await user.type(screen.getByLabelText('Slug'), '4a-etapa')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma etapa com a sigla 2')
    await user.clear(screen.getByLabelText('Sigla'))
    await user.type(screen.getByLabelText('Sigla'), '4')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('heading', { level: 1, name: '4ª ETAPA' })).toBeInTheDocument()
    expect(screen.getByText('/vincular_etapa 4a-etapa')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma obra nesta etapa.')).toBeInTheDocument()
    expect(screen.getByLabelText('Latitude')).toHaveValue('-3,761')
    expect(screen.getByText(/Faltam para o boletim: obra\/serviço/)).toBeInTheDocument()
  })

  it('tocar no mapa preenche latitude e longitude', async () => {
    const user = userEvent.setup()
    renderizar('/nova-etapa')
    expect(await screen.findByTestId('mapa-vazio')).toHaveTextContent('Toque no mapa')
    await user.click(await screen.findByRole('button', { name: 'Tocar no mapa' }))
    expect(screen.getByLabelText('Latitude')).toHaveValue('-3,761234')
    expect(screen.getByLabelText('Longitude')).toHaveValue('-38,530123')
    expect(screen.queryByTestId('mapa-vazio')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'abrir no mapa' })).toHaveAttribute('href', expect.stringContaining('mlat=-3.761234'))
  })

  it('cartão Boletins: horário da emissão automática e link para a aba filtrada pela etapa', async () => {
    renderizar('/etapas/2a-etapa')
    const secao = await screen.findByRole('region', { name: 'Boletins' })
    expect(secao).toHaveTextContent(/Emissão automática todos os dias às \d{2}:\d{2} \(Fortaleza\)/)
    expect(within(secao).getByRole('link', { name: 'Ver boletins da etapa' })).toHaveAttribute('href', '/boletins?etapa=2a-etapa')
    expect(screen.queryByRole('table', { name: 'Boletins emitidos' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Data do boletim')).not.toBeInTheDocument()
  })

  it('edita nome e ordem da etapa', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarEtapa')
    renderizar('/etapas/3a-etapa', repo)
    const nome = await screen.findByLabelText('Nome')
    expect(screen.getByLabelText('Slug')).toBeDisabled()
    await user.clear(nome)
    await user.type(nome, '3ª ETAPA (alojamentos)')
    await user.click(screen.getByRole('button', { name: 'Salvar etapa' }))
    expect(await screen.findByText('Etapa salva.')).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({ id: 'etapa-3a', nome: '3ª ETAPA (alojamentos)', ordem: 3 })
    expect(await screen.findByRole('heading', { level: 1, name: '3ª ETAPA (alojamentos)' })).toBeInTheDocument()
  })

  it('desvincular o grupo pede confirmação e solta os tópicos das obras', async () => {
    const user = userEvent.setup()
    const repo = renderizar('/etapas/2a-etapa')
    expect((await repo.obterObra('hto')).obra.telegram_vinculado).toBe(true)
    await user.click(await screen.findByRole('button', { name: 'Desvincular grupo' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Fiscalização 2ª ETAPA')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desvincular grupo' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar: desvincular o grupo de 2ª ETAPA' }))
    expect(await screen.findByText('/vincular_etapa 2a-etapa')).toBeInTheDocument()
    expect((await repo.obterObra('hto')).obra.telegram_vinculado).toBe(false)
  })

  it('arquivar pede confirmação, vai para "Etapas arquivadas" e desarquivar devolve cada obra como estava', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    await repo.arquivarObra('cofz', true)
    renderizar('/etapas/2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: 'Arquivar etapa' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar: arquivar 2ª ETAPA' }))
    expect(await screen.findByText(/Etapa arquivada em/)).toBeInTheDocument()
    // a obra mostra o aviso da etapa arquivada
    const hto = await repo.obterObra('hto')
    expect(hto.obra.etapa?.arquivada_em).not.toBeNull()
    expect(hto.obra.arquivada_em).toBeNull()

    await user.click(screen.getByRole('link', { name: '← Etapas' }))
    const arquivadas = await screen.findByRole('table', { name: 'Etapas arquivadas' })
    expect(within(arquivadas).getByRole('link', { name: '2ª ETAPA' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '2ª ETAPA' })).not.toBeInTheDocument()

    await user.click(within(arquivadas).getByRole('link', { name: '2ª ETAPA' }))
    await user.click(await screen.findByRole('button', { name: 'Desarquivar etapa' }))
    expect(await screen.findByRole('button', { name: 'Arquivar etapa' })).toBeInTheDocument()
    expect(screen.queryByText(/Etapa arquivada em/)).not.toBeInTheDocument()
    expect((await repo.obterObra('cofz')).obra.arquivada_em).not.toBeNull()
    expect((await repo.obterObra('hto')).obra.arquivada_em).toBeNull()
  })

  it('excluir mostra as obras e as contagens, exige o nome exato e volta à tela inicial com o aviso', async () => {
    const user = userEvent.setup()
    const repo = renderizar('/etapas/2a-etapa')
    const excluir = vi.spyOn(repo, 'excluirEtapa')
    await user.click(await screen.findByRole('button', { name: 'Excluir etapa…' }))
    const obras = await screen.findByRole('list', { name: 'Obras que serão apagadas' })
    expect(within(obras).getAllByRole('listitem')).toHaveLength(2)
    expect(obras).toHaveTextContent('HTO')
    expect(obras).toHaveTextContent('COFZ')
    // 87 da HTO + os da COFZ
    expect(screen.getByRole('list', { name: 'O que será apagado' })).toHaveTextContent(/\d+ ambientes/)
    const botao = screen.getByRole('button', { name: 'Excluir 2ª ETAPA definitivamente' })
    const campo = screen.getByLabelText(/digite o nome da etapa/)
    await user.type(campo, '2a etapa')
    expect(botao).toBeDisabled()
    await user.clear(campo)
    await user.type(campo, '  2ª ETAPA ')
    expect(botao).toBeEnabled()
    await user.click(botao)

    expect(await screen.findByText('Etapa 2ª ETAPA excluída com 2 obras, com todos os dados e arquivos.')).toBeInTheDocument()
    expect(excluir).toHaveBeenCalledWith('2a-etapa', '  2ª ETAPA ')
    expect(screen.queryByRole('region', { name: '2ª ETAPA' })).not.toBeInTheDocument()
    const excluidas = await screen.findByRole('region', { name: 'Obras excluídas' })
    expect(within(excluidas).getAllByText('2ª ETAPA (excluída junto)')).toHaveLength(2)
    await expect(repo.obterObra('hto')).rejects.toThrow('Obra não encontrada')
    expect((await repo.listarEtapas()).map((e) => e.slug)).toEqual(['3a-etapa'])
  })

  it('etapa sem obras também pode ser excluída', async () => {
    const user = userEvent.setup()
    renderizar('/etapas/3a-etapa')
    await user.click(await screen.findByRole('button', { name: 'Excluir etapa…' }))
    expect(await screen.findByText('A etapa não tem obras: só a etapa será apagada.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/digite o nome da etapa/), '3ª ETAPA')
    await user.click(screen.getByRole('button', { name: 'Excluir 3ª ETAPA definitivamente' }))
    expect(await screen.findByText('Etapa 3ª ETAPA excluída sem obras, com todos os dados e arquivos.')).toBeInTheDocument()
  })

  it('aviso quando sobram arquivos no Storage', async () => {
    const user = userEvent.setup()
    const base = criarRepositorioAdminFixture()
    const repo: RepositorioAdmin = {
      ...base,
      excluirEtapa: async (slug, confirmacao) => ({
        ...(await base.excluirEtapa(slug, confirmacao)),
        pendente: true,
        erro: 'timeout no Storage',
      }),
    }
    renderizar('/etapas/3a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: 'Excluir etapa…' }))
    await user.type(await screen.findByLabelText(/digite o nome da etapa/), '3ª ETAPA')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Excluir 3ª ETAPA definitivamente' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Excluir 3ª ETAPA definitivamente' }))
    expect(await screen.findByText(/parte dos arquivos ficou no Storage \(timeout no Storage\)/)).toBeInTheDocument()
  })

  it('a confirmação errada é recusada também pelo repositório', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.excluirEtapa('2a-etapa', '2a-etapa')).rejects.toThrow('digite exatamente o nome da etapa: 2ª ETAPA')
    expect((await repo.listarObras()).map((o) => o.slug)).toEqual(['hto', 'cofz'])
  })
})

describe('obra dentro da etapa (fixture)', () => {
  it('nova obra pela etapa já vem com a etapa escolhida', async () => {
    const user = userEvent.setup()
    const repo = renderizar('/nova-obra?etapa=3a-etapa')
    expect(await screen.findByLabelText('Etapa')).toHaveDisplayValue('3ª ETAPA')
    await user.type(screen.getByLabelText(/Slug/), 'bloco-a')
    await user.type(screen.getByLabelText('Nome'), 'Bloco A')
    await user.click(screen.getByRole('button', { name: 'Criar obra' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Bloco A' })).toBeInTheDocument()
    expect((await repo.obterObra('bloco-a')).obra.etapa?.slug).toBe('3a-etapa')
  })

  it('sem etapa na URL, a etapa é obrigatória', async () => {
    const user = userEvent.setup()
    renderizar('/nova-obra')
    expect(await screen.findByLabelText('Etapa')).toHaveValue('')
    await user.type(screen.getByLabelText(/Slug/), 'bloco-b')
    await user.type(screen.getByLabelText('Nome'), 'Bloco B')
    // o select é `required`: o envio vai pelo botão, mas a validação é a do formulário
    await user.click(screen.getByRole('button', { name: 'Criar obra' }))
    expect(screen.queryByRole('heading', { level: 1, name: 'Bloco B' })).not.toBeInTheDocument()
  })

  it('a página da obra mostra a etapa, muda de etapa e avisa quando a etapa está arquivada', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarObra')
    renderizar('/obras/hto', repo)
    expect(await screen.findByRole('link', { name: '2ª ETAPA' })).toHaveAttribute('href', '/etapas/2a-etapa')
    await user.selectOptions(await screen.findByLabelText('Etapa'), '3ª ETAPA')
    expect(screen.getByText('Ao salvar, a obra passa para a etapa 3ª ETAPA.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar obra' }))
    expect(await screen.findByText('Obra salva.')).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({ id: 'obra-hto', nome: 'HTO', ordem: 0, etapa_id: 'etapa-3a' })
    expect(await screen.findByRole('link', { name: '3ª ETAPA' })).toBeInTheDocument()
    // grupo diferente (a 3ª não tem grupo): o tópico da obra foi solto
    const hto = await repo.obterObra('hto')
    expect(hto.obra.telegram_vinculado).toBe(false)

    await repo.arquivarEtapa('3a-etapa', true)
    renderizar('/obras/hto', repo)
    expect(await screen.findByText(/A etapa 3ª ETAPA está arquivada/)).toBeInTheDocument()
  })
})
