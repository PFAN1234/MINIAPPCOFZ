import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import type { RepositorioAdmin } from '../../dados/repositorio.ts'
import { criarEntrada } from '../../entrada.ts'
import { hojeIso } from '../../formato.ts'

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

describe('lista de etapas: sigla e cadastro incompleto', () => {
  it('mostra a sigla e só marca "cadastro incompleto" na etapa com campos vazios', async () => {
    renderizar('/')
    const segunda = await screen.findByRole('region', { name: '2ª ETAPA' })
    expect(within(segunda).getByText('sigla 2')).toBeInTheDocument()
    expect(within(segunda).queryByText('cadastro incompleto')).not.toBeInTheDocument()
    const terceira = screen.getByRole('region', { name: '3ª ETAPA' })
    expect(within(terceira).getByText('cadastro incompleto')).toBeInTheDocument()
    expect(within(terceira).queryByText(/^sigla/)).not.toBeInTheDocument()
  })
})

describe('nova etapa: formulário em seções', () => {
  it('tem as três seções, marca os obrigatórios e mostra a prévia do número do boletim', async () => {
    const user = userEvent.setup()
    renderizar('/nova-etapa')
    for (const nome of ['Identificação', 'Localização', 'Dados do contrato']) {
      expect(await screen.findByRole('heading', { level: 2, name: nome })).toBeInTheDocument()
    }
    expect(screen.getByText('Sigla')).toHaveClass('adm-obrigatorio')
    expect(screen.getByText('Latitude')).toHaveClass('adm-obrigatorio')
    expect(screen.getByText('Fuso horário')).toHaveClass('adm-obrigatorio')
    expect(screen.getByText('Contrato')).not.toHaveClass('adm-obrigatorio')
    expect(screen.queryByRole('heading', { name: 'Responsáveis' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Aditivos' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Sigla'), 'ab-1')
    const d = hojeIso()
    const esperado = `BAAB1/${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}/COFZ`
    expect(await screen.findByText(esperado)).toBeInTheDocument()
    expect(screen.getByLabelText('Sigla')).toHaveValue('AB1')
    expect(screen.getByLabelText('Fuso horário')).toHaveDisplayValue('São Paulo / Brasília (UTC−3)')
    expect(screen.getByLabelText('Horário de emissão')).toHaveValue('23:30')
  })

  it('o mapa só aparece com coordenadas válidas e usa o iframe do OpenStreetMap', async () => {
    const user = userEvent.setup()
    renderizar('/nova-etapa')
    expect(await screen.findByTestId('mapa-vazio')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Latitude'), '-3,7610')
    await user.type(screen.getByLabelText('Longitude'), '-38,5297')
    const mapa = screen.getByTitle(/Mapa da obra/)
    const src = mapa.getAttribute('src') ?? ''
    expect(src).toMatch(/^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=-38\.53570%2C-3\.76500%2C-38\.52370%2C-3\.75700&layer=mapnik&marker=-3\.761%2C-38\.5297$/)
    expect(screen.getByRole('link', { name: 'abrir no mapa' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/?mlat=-3.761&mlon=-38.5297#map=17/-3.761/-38.5297',
    )
    expect(screen.getByText('-3,7610, -38,5297', { exact: false })).toBeInTheDocument()
    // fora do Brasil: sem mapa
    await user.clear(screen.getByLabelText('Latitude'))
    await user.type(screen.getByLabelText('Latitude'), '40')
    expect(screen.queryByTitle(/Mapa da obra/)).not.toBeInTheDocument()
  })

  it('sem estações cadastradas, pede o código; com coordenadas, oferece as mais próximas', async () => {
    const user = userEvent.setup()
    renderizar('/nova-etapa')
    const campo = await screen.findByRole('textbox', { name: 'Estação INMET' })
    expect(screen.getAllByText('A lista de estações aparece depois da primeira coleta de clima.')).toHaveLength(2)
    await user.type(campo, 'a30')
    expect(campo).toHaveValue('A30')

    await user.type(screen.getByLabelText('Latitude'), '-3,761')
    await user.type(screen.getByLabelText('Longitude'), '-38,5297')
    const lista = await screen.findByRole('combobox', { name: 'Estação INMET' })
    const opcoes = within(lista).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(opcoes.slice(0, 2)).toEqual(['Nenhuma', 'A30 (atual)'])
    expect(opcoes.slice(2).map((o) => o.slice(0, 4))).toEqual(['A305', 'A360', 'A347'])
    expect(opcoes[2]).toMatch(/^A305 · FORTALEZA \(CE\) · \d+,\d km$/)
    // o valor digitado, que não está na lista, continua disponível
    expect(lista).toHaveValue('A30')
    await user.selectOptions(lista, 'A305')
    expect(lista).toHaveValue('A305')
  })

  it('sem sugestões (tabela vazia), mantém o campo de código', async () => {
    const repo = criarRepositorioAdminFixture()
    vi.spyOn(repo, 'sugerirEstacoes').mockResolvedValue([])
    const user = userEvent.setup()
    renderizar('/nova-etapa', repo)
    await user.type(await screen.findByLabelText('Latitude'), '-3,761')
    await user.type(screen.getByLabelText('Longitude'), '-38,5297')
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.getByRole('textbox', { name: 'Estação INMET' })).toBeInTheDocument()
  })

  it('aplica as máscaras de CNPJ e de valor e cria a etapa com todos os dados', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarEtapa')
    renderizar('/nova-etapa', repo)
    await user.type(await screen.findByLabelText('Slug'), '6a-etapa')
    await user.type(screen.getByLabelText('Nome'), '6ª ETAPA')
    await user.type(screen.getByLabelText('Sigla'), '6')
    await user.type(screen.getByLabelText('Latitude'), '-3,7')
    await user.type(screen.getByLabelText('Longitude'), '-38,5')
    await user.type(screen.getByLabelText('CNPJ da contratada'), '12345678000195')
    expect(screen.getByLabelText('CNPJ da contratada')).toHaveValue('12.345.678/0001-95')
    await user.type(screen.getByLabelText('Valor original (R$)'), '7949900000')
    expect(screen.getByLabelText('Valor original (R$)')).toHaveValue('79.499.000,00')
    await user.type(screen.getByLabelText('Área construída (m²)'), '86.102,17')
    await user.type(screen.getByLabelText('Vigência (meses)'), '18')
    await user.type(screen.getByLabelText('Contrato'), '  120/2025 - SOP ')
    fireEvent.change(screen.getByLabelText('Data da OS'), { target: { value: '2025-06-02' } })
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))

    expect(await screen.findByRole('heading', { level: 1, name: '6ª ETAPA' })).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({
      slug: '6a-etapa',
      nome: '6ª ETAPA',
      ordem: 0,
      sigla: '6',
      latitude: -3.7,
      longitude: -38.5,
      fuso: 'America/Sao_Paulo',
      boletim_horario: '23:30',
      contratada_cnpj: '12.345.678/0001-95',
      valor_original: 79499000,
      area_construida_m2: 86102.17,
      vigencia_meses: 18,
      contrato: '120/2025 - SOP',
      os_data: '2025-06-02',
    })
    expect(screen.getByLabelText('Valor original (R$)')).toHaveValue('79.499.000,00')
    expect(screen.getByLabelText('Contrato')).toHaveValue('120/2025 - SOP')
  })

  it('recusa CNPJ incompleto e longitude fora do Brasil antes de chamar o servidor', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarEtapa')
    renderizar('/nova-etapa', repo)
    await user.type(await screen.findByLabelText('Slug'), '7a-etapa')
    await user.type(screen.getByLabelText('Nome'), '7ª ETAPA')
    await user.type(screen.getByLabelText('Sigla'), '7')
    await user.type(screen.getByLabelText('Latitude'), '-3,7')
    await user.type(screen.getByLabelText('Longitude'), '-10')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Longitude fora do Brasil')
    await user.clear(screen.getByLabelText('Longitude'))
    await user.type(screen.getByLabelText('Longitude'), '-38,5')
    await user.type(screen.getByLabelText('CNPJ da contratada'), '123')
    await user.click(screen.getByRole('button', { name: 'Criar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('CNPJ incompleto')
    expect(salvar).not.toHaveBeenCalled()
  })
})

describe('página da etapa: cadastro', () => {
  it('mostra os dados da 2ª etapa já formatados e sem aviso de campos faltando', async () => {
    renderizar('/etapas/2a-etapa')
    expect(await screen.findByLabelText('Sigla')).toHaveValue('2')
    expect(screen.getByLabelText('Slug')).toBeDisabled()
    expect(screen.getByLabelText('Latitude')).toHaveValue('-3,761')
    expect(screen.getByLabelText('Longitude')).toHaveValue('-38,5297')
    expect(screen.getByLabelText('Fuso horário')).toHaveDisplayValue('Fortaleza (UTC−3)')
    expect(screen.getByLabelText('Valor original (R$)')).toHaveValue('79.499.000,00')
    expect(screen.getByLabelText('Área construída (m²)')).toHaveValue('86.102,17')
    expect(screen.getByLabelText('CNPJ da contratada')).toHaveValue('12.345.678/0001-95')
    expect(screen.getByLabelText('Contrato')).toHaveValue('120/2025 - SOP')
    expect(screen.getByLabelText('Data da OS')).toHaveValue('2025-06-02')
    expect(screen.getByTitle(/Mapa da obra/)).toBeInTheDocument()
    expect(screen.queryByText(/Faltam para o boletim/)).not.toBeInTheDocument()
    // as seções que já existiam continuam
    expect(screen.getByRole('heading', { name: 'Grupo do Telegram' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Obras da etapa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excluir etapa…' })).toBeInTheDocument()
  })

  it('a etapa sem cadastro lista o que falta e some com o aviso quando completa', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarEtapa')
    renderizar('/etapas/3a-etapa', repo)
    const aviso = await screen.findByText(/^Faltam para o boletim:/)
    expect(aviso).toHaveTextContent(
      'Faltam para o boletim: sigla, localização (latitude e longitude), estação do INMET, obra/serviço, local, contratante, contrato, contratada, CNPJ da contratada, número da OS, data da OS, vigência, valor original, área construída, responsáveis.',
    )
    await user.type(screen.getByLabelText('Sigla'), '3')
    await user.type(screen.getByLabelText('Latitude'), '-3,7')
    await user.type(screen.getByLabelText('Longitude'), '-38,5')
    await user.click(screen.getByRole('button', { name: 'Salvar etapa' }))
    expect(await screen.findByText('Etapa salva.')).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({ id: 'etapa-3a', nome: '3ª ETAPA', ordem: 3, sigla: '3', latitude: -3.7, longitude: -38.5 })
    expect(await screen.findByText(/^Faltam para o boletim: estação do INMET/)).toBeInTheDocument()
    expect(screen.getByLabelText('Latitude')).toHaveValue('-3,7')
  })

  it('só envia o que mudou e apaga um campo quando ele é esvaziado', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarEtapa')
    renderizar('/etapas/2a-etapa', repo)
    const contrato = await screen.findByLabelText('Contrato')
    await user.clear(contrato)
    await user.type(contrato, '121/2025 - SOP')
    await user.clear(screen.getByLabelText('Obra/serviço'))
    await user.click(screen.getByRole('button', { name: 'Salvar etapa' }))
    expect(await screen.findByText('Etapa salva.')).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({ id: 'etapa-2a', nome: '2ª ETAPA', ordem: 2, contrato: '121/2025 - SOP', objeto: null })
    expect(await screen.findByText(/^Faltam para o boletim: obra\/serviço\.$/)).toBeInTheDocument()
  })

  it('mostra o erro do servidor (sigla repetida) como está', async () => {
    const user = userEvent.setup()
    renderizar('/etapas/3a-etapa')
    await user.type(await screen.findByLabelText('Sigla'), '2')
    await user.type(screen.getByLabelText('Latitude'), '-3,7')
    await user.type(screen.getByLabelText('Longitude'), '-38,5')
    await user.click(screen.getByRole('button', { name: 'Salvar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma etapa com a sigla 2')
  })

  it('não deixa apagar a sigla de uma etapa que já tem', async () => {
    const user = userEvent.setup()
    renderizar('/etapas/2a-etapa')
    await user.clear(await screen.findByLabelText('Sigla'))
    await user.click(screen.getByRole('button', { name: 'Salvar etapa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A sigla não pode ser apagada')
  })
})

describe('responsáveis da etapa', () => {
  it('lista com o nome de exibição, inclui, reordena, troca a função e salva', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const definir = vi.spyOn(repo, 'definirResponsaveis')
    renderizar('/etapas/2a-etapa', repo)
    const secao = await screen.findByRole('region', { name: 'Responsáveis' })
    const tabela = await within(secao).findByRole('table', { name: 'Responsáveis da etapa' })
    expect(within(tabela).getByText('CP PATRICIO')).toBeInTheDocument()
    expect(within(tabela).getByText(/Telegram: Patrício Ferreira/)).toBeInTheDocument()
    expect(within(secao).getByRole('button', { name: 'Salvar responsáveis' })).toBeDisabled()

    // quem já está na lista não volta a aparecer entre as opções
    const escolha = within(secao).getByLabelText('Pessoa')
    expect(within(escolha).queryByRole('option', { name: /CP PATRICIO/ })).not.toBeInTheDocument()
    await user.selectOptions(escolha, 'usuario-eduardo')
    await user.clear(within(secao).getByLabelText('Função'))
    await user.type(within(secao).getByLabelText('Função'), 'Fiscal substituto')
    await user.click(within(secao).getByRole('button', { name: 'Adicionar responsável' }))
    await user.click(within(secao).getByRole('button', { name: 'Subir Eduardo Lima' }))
    await user.clear(within(secao).getByLabelText('Função de CP PATRICIO'))
    await user.type(within(secao).getByLabelText('Função de CP PATRICIO'), 'Gestor do contrato')
    await user.click(within(secao).getByRole('button', { name: 'Salvar responsáveis' }))

    expect(await within(secao).findByText('Responsáveis salvos.')).toBeInTheDocument()
    expect(definir).toHaveBeenCalledWith('etapa-2a', [
      { usuario_id: 'usuario-eduardo', funcao: 'Fiscal substituto' },
      { usuario_id: 'usuario-patricio', funcao: 'Gestor do contrato' },
    ])
    expect((await repo.obterEtapa('2a-etapa')).responsaveis.map((r) => r.ordem)).toEqual([0, 1])
  })

  it('remover todos devolve o aviso "responsáveis" em "Faltam para o boletim"', async () => {
    const user = userEvent.setup()
    renderizar('/etapas/2a-etapa')
    const secao = await screen.findByRole('region', { name: 'Responsáveis' })
    await user.click(await within(secao).findByRole('button', { name: 'Remover CP PATRICIO dos responsáveis' }))
    expect(within(secao).getByText(/Nenhum responsável/)).toBeInTheDocument()
    await user.click(within(secao).getByRole('button', { name: 'Salvar responsáveis' }))
    expect(await screen.findByText('Faltam para o boletim: responsáveis.')).toBeInTheDocument()
    expect(within(secao).getByText('Responsáveis salvos.')).toBeInTheDocument()
  })
})

describe('aditivos da etapa', () => {
  it('mostra o término e o valor atualizados e a tabela de aditivos', async () => {
    renderizar('/etapas/2a-etapa')
    const secao = await screen.findByRole('region', { name: 'Aditivos' })
    const resumo = within(secao).getByLabelText('Prazo e valor atualizados')
    expect(resumo).toHaveTextContent('Término original02/06/2027')
    expect(resumo).toHaveTextContent('Prazo dos aditivos+90 dias')
    expect(resumo).toHaveTextContent('Término atual31/08/2027')
    expect(resumo).toHaveTextContent('Valor atualR$ 80.749.000,00')
    const linha = within(within(secao).getByRole('table', { name: 'Aditivos do contrato' })).getByRole('row', { name: /1º TA/ })
    expect(linha).toHaveTextContent('10/03/2026')
    expect(linha).toHaveTextContent('+90 dias')
    expect(linha).toHaveTextContent('R$ 1.250.000,00')
  })

  it('adiciona um aditivo de supressão, recusa número repetido e atualiza o resumo', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarAditivo')
    renderizar('/etapas/2a-etapa', repo)
    const secao = await screen.findByRole('region', { name: 'Aditivos' })
    await user.click(await within(secao).findByRole('button', { name: 'Adicionar aditivo' }))
    await user.type(within(secao).getByLabelText('Número do aditivo'), '1º TA')
    await user.click(within(secao).getByRole('button', { name: 'Salvar aditivo' }))
    expect(await within(secao).findByRole('alert')).toHaveTextContent('Informe a data do aditivo')
    fireEvent.change(within(secao).getByLabelText('Data do aditivo'), { target: { value: '2026-09-01' } })
    await user.click(within(secao).getByRole('button', { name: 'Salvar aditivo' }))
    expect(await within(secao).findByRole('alert')).toHaveTextContent('Já existe o aditivo 1º TA nesta etapa')

    await user.clear(within(secao).getByLabelText('Número do aditivo'))
    await user.type(within(secao).getByLabelText('Número do aditivo'), '2º TA')
    await user.clear(within(secao).getByLabelText('Prazo (dias)'))
    await user.type(within(secao).getByLabelText('Prazo (dias)'), '-10')
    await user.type(within(secao).getByLabelText('Valor do aditivo (R$)'), '-500000')
    expect(within(secao).getByLabelText('Valor do aditivo (R$)')).toHaveValue('-5.000,00')
    await user.type(within(secao).getByLabelText('Descrição do aditivo'), 'Supressão de paisagismo')
    await user.click(within(secao).getByRole('button', { name: 'Salvar aditivo' }))

    expect(await within(secao).findByText('Aditivo 2º TA salvo.')).toBeInTheDocument()
    expect(salvar).toHaveBeenLastCalledWith({
      etapa_id: 'etapa-2a',
      numero: '2º TA',
      data: '2026-09-01',
      prazo_dias: -10,
      valor: -5000,
      descricao: 'Supressão de paisagismo',
    })
    const resumo = within(secao).getByLabelText('Prazo e valor atualizados')
    expect(resumo).toHaveTextContent('Prazo dos aditivos+80 dias')
    expect(resumo).toHaveTextContent('Término atual21/08/2027')
    expect(resumo).toHaveTextContent('Valor atualR$ 80.744.000,00')
    expect(within(secao).getByRole('row', { name: /2º TA/ })).toHaveTextContent('-R$ 5.000,00')
  })

  it('edita e remove (com confirmação) um aditivo', async () => {
    const user = userEvent.setup()
    renderizar('/etapas/2a-etapa')
    const secao = await screen.findByRole('region', { name: 'Aditivos' })
    await user.click(await within(secao).findByRole('button', { name: 'Editar aditivo 1º TA' }))
    expect(within(secao).getByRole('form', { name: 'Editar aditivo' })).toBeInTheDocument()
    expect(within(secao).getByLabelText('Valor do aditivo (R$)')).toHaveValue('1.250.000,00')
    expect(within(secao).getByLabelText('Data do aditivo')).toHaveValue('2026-03-10')
    await user.clear(within(secao).getByLabelText('Prazo (dias)'))
    await user.type(within(secao).getByLabelText('Prazo (dias)'), '30')
    await user.click(within(secao).getByRole('button', { name: 'Salvar aditivo' }))
    expect(await within(secao).findByText('Aditivo 1º TA salvo.')).toBeInTheDocument()
    expect(within(secao).getByLabelText('Prazo e valor atualizados')).toHaveTextContent('Término atual02/07/2027')

    await user.click(within(secao).getByRole('button', { name: 'Remover aditivo 1º TA' }))
    await user.click(within(secao).getByRole('button', { name: 'Cancelar' }))
    expect(within(secao).getByRole('row', { name: /1º TA/ })).toBeInTheDocument()
    await user.click(within(secao).getByRole('button', { name: 'Remover aditivo 1º TA' }))
    await user.click(within(secao).getByRole('button', { name: 'Confirmar remoção de 1º TA' }))
    expect(await within(secao).findByText('Aditivo 1º TA removido.')).toBeInTheDocument()
    expect(within(secao).getByText('Nenhum aditivo cadastrado.')).toBeInTheDocument()
    expect(within(secao).getByLabelText('Prazo e valor atualizados')).toHaveTextContent('Valor atualR$ 79.499.000,00')
  })

  it('sem data da OS e vigência, explica por que não há término', async () => {
    renderizar('/etapas/3a-etapa')
    const secao = await screen.findByRole('region', { name: 'Aditivos' })
    expect(within(secao).getByText(/Informe a data da OS e a vigência/)).toBeInTheDocument()
    expect(within(secao).queryByLabelText('Prazo e valor atualizados')).not.toBeInTheDocument()
  })
})
