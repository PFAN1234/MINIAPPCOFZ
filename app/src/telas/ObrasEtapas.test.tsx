import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture, ETAPA_2, ETAPA_3, ETAPA_4 } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import { criarRepositorioSupabase } from '../dados/supabase.ts'
import type { EquipeServico, Posicao } from '../dados/tipos.ts'
import { renderizarApp } from '../test/renderApp.tsx'
import { chaveEtapaGuardada } from '../util/etapas.ts'
import { ErroLocalizacao } from '../util/localizacao.ts'

const POSICAO: Posicao = { latitude: -3.7, longitude: -38.5, precisao: 12 }

const mocks = vi.hoisted(() => ({ obterPosicao: vi.fn() }))
vi.mock('../util/localizacao.ts', async (original) => ({
  ...(await original<typeof import('../util/localizacao.ts')>()),
  obterPosicao: mocks.obterPosicao,
}))

beforeEach(() => {
  mocks.obterPosicao.mockResolvedValue(POSICAO)
})

afterEach(() => {
  vi.restoreAllMocks()
  mocks.obterPosicao.mockReset()
})

const CHAVE = chaveEtapaGuardada('usuario-teste')

function aba(nome: string) {
  return screen.findByRole('tab', { name: nome })
}

describe('Obras: abas de etapa', () => {
  it('mostra todas as etapas ativas lado a lado, sem "Últimos registros"', async () => {
    renderizarApp('/')
    const lista = await screen.findByRole('tablist', { name: 'Etapa' })
    await waitFor(() =>
      expect(within(lista).getAllByRole('tab').map((t) => t.textContent)).toEqual([
        '2ª ETAPA',
        '3ª ETAPA',
        '4ª ETAPA',
      ]),
    )
    expect(await aba('2ª ETAPA')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Últimos registros' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Equipe de serviço' })).toBeInTheDocument()
  })

  it('troca a lista, as "Outras obras" e guarda a escolha', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/')
    expect(await screen.findByRole('link', { name: /Residencial Aurora/ })).toBeInTheDocument()
    expect(await screen.findByText('Obra Demonstração')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Bloco de Alojamentos/ })).not.toBeInTheDocument()

    await usuario.click(await aba('3ª ETAPA'))
    expect(screen.getByRole('link', { name: /Bloco de Alojamentos/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^HTO/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Obra Demonstração')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '3ª ETAPA' })).toHaveAttribute('aria-selected', 'true')
    expect(localStorage.getItem(CHAVE)).toBe(ETAPA_3.id)
  })

  it('lembra a etapa escolhida; a guardada que sumiu dá lugar à primeira', async () => {
    localStorage.setItem(CHAVE, ETAPA_3.id)
    const { unmount } = renderizarApp('/')
    expect(await screen.findByRole('link', { name: /Bloco de Alojamentos/ })).toBeInTheDocument()
    expect(await aba('3ª ETAPA')).toHaveAttribute('aria-selected', 'true')
    unmount()

    localStorage.setItem(CHAVE, 'etapa-que-sumiu')
    renderizarApp('/')
    expect(await screen.findByRole('link', { name: /^HTO/ })).toBeInTheDocument()
    expect(await aba('2ª ETAPA')).toHaveAttribute('aria-selected', 'true')
  })

  it('aparece mesmo com uma etapa só', async () => {
    const fixture = criarRepositorioFixture()
    const repo: Repositorio = {
      ...fixture,
      etapasInicio: async () => (await fixture.etapasInicio()).filter((e) => e.id === ETAPA_2.id),
      listarObras: async () => (await fixture.listarObras()).filter((o) => o.etapa.id === ETAPA_2.id),
    }
    renderizarApp('/', repo)
    expect(await screen.findByRole('link', { name: /^HTO/ })).toBeInTheDocument()
    expect(await screen.findAllByRole('tab')).toHaveLength(1)
  })

  it('funciona sem `etapas_inicio` (sem sinal): usa as etapas das obras', async () => {
    const repo: Repositorio = {
      ...criarRepositorioFixture(),
      etapasInicio: () => Promise.reject(new Error('sem sinal')),
    }
    renderizarApp('/', repo)
    expect(await screen.findByRole('link', { name: /^HTO/ })).toBeInTheDocument()
    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual(['2ª ETAPA', '3ª ETAPA'])
  })

  it('etapa em que não participa e sem obra para pedir: aviso no lugar da lista', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/')
    await usuario.click(await aba('4ª ETAPA'))
    expect(await screen.findByText('Você não participa desta etapa')).toBeInTheDocument()
    expect(screen.getByText(/Entre no grupo dela no Telegram e abra o app de novo para pedir acesso\./)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^HTO/ })).not.toBeInTheDocument()
    // A equipe é só leitura: lista o colega, sem botão de check-in.
    expect(await screen.findByText('SD COLEGA')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check-(in|out)/ })).not.toBeInTheDocument()
  })

  it('etapa só das "Outras obras" também vira aba', async () => {
    const usuario = userEvent.setup()
    const repo: Repositorio = {
      ...criarRepositorioFixture(),
      obrasDisponiveis: async () => [
        { id: 'o9', slug: 'quartel', nome: 'Quartel', solicitacao: null, etapa_id: 'e1', etapa_nome: '1ª ETAPA', etapa_ordem: 1 },
      ],
    }
    renderizarApp('/', repo)
    const primeira = await aba('1ª ETAPA')
    await usuario.click(primeira)
    expect(screen.getByText('Quartel')).toBeInTheDocument()
    expect(screen.queryByText('Você não participa desta etapa')).not.toBeInTheDocument()
  })

  it('sem localStorage, a troca de aba vale só nesta abertura', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const usuario = userEvent.setup()
    renderizarApp('/')
    await usuario.click(await aba('3ª ETAPA'))
    expect(await screen.findByRole('link', { name: /Bloco de Alojamentos/ })).toBeInTheDocument()
  })
})

describe('Obras: equipe de serviço', () => {
  it('vazia: aviso e botão Fazer check-in', async () => {
    renderizarApp('/')
    expect(await screen.findByText('Ninguém de serviço agora.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeEnabled()
  })

  it('check-in: mostra "(você)", "Em serviço desde" e troca o botão; check-out pede confirmação', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/')
    await usuario.click(await screen.findByRole('button', { name: 'Fazer check-in' }))
    expect(mocks.obterPosicao).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('CP TESTE (você)')).toBeInTheDocument()
    expect(screen.getByText(/^Em serviço desde \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Fazer check-out' }))
    // Ainda não saiu: pede confirmação (e dá para cancelar).
    expect(screen.getByText(/^Em serviço desde/)).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Fazer check-out' })).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Fazer check-out' }))
    await usuario.click(screen.getByRole('button', { name: 'Confirmar check-out' }))

    expect(await screen.findByText(/^\d{2}:\d{2} – \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeInTheDocument()
  })

  it('serviço aberto em outra etapa: avisa e oferece o check-out dela, sem check-in', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/')
    await usuario.click(await screen.findByRole('button', { name: 'Fazer check-in' }))
    await screen.findByText('CP TESTE (você)')

    await usuario.click(await aba('3ª ETAPA'))
    expect(await screen.findByText('Você está de serviço na 2ª ETAPA')).toBeInTheDocument()
    expect(screen.getByText('Ninguém de serviço agora.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Fazer check-out' }))
    await usuario.click(screen.getByRole('button', { name: 'Confirmar check-out' }))
    expect(await screen.findByRole('button', { name: 'Fazer check-in' })).toBeInTheDocument()
    expect(screen.queryByText(/Você está de serviço na/)).not.toBeInTheDocument()
  })

  it('mostra encerrados, incluindo a saída não registrada', async () => {
    const equipe: EquipeServico = {
      etapa_id: ETAPA_2.id,
      participa: true,
      tem_localizacao: true,
      meu_servico: null,
      equipe: [
        { id: 'a', usuario_id: 'u1', nome: 'CP ANA', entrada_em: '2026-01-05T11:00:00Z', saida_em: '2026-01-05T20:00:00Z', saida_automatica: false, eu: false },
        { id: 'b', usuario_id: 'u2', nome: 'SD BIA', entrada_em: '2026-01-05T11:00:00Z', saida_em: '2026-01-06T11:00:00Z', saida_automatica: true, eu: false },
      ],
    }
    const repo: Repositorio = { ...criarRepositorioFixture(), equipeServico: async () => equipe }
    renderizarApp('/', repo)
    expect(await screen.findByText('CP ANA')).toBeInTheDocument()
    expect(screen.getByText(/^05\/01 08:00 – 05\/01 17:00$/)).toBeInTheDocument()
    expect(screen.getByText(/^05\/01 08:00 – saída não registrada$/)).toBeInTheDocument()
  })

  it('erro do servidor no check-in aparece como alerta', async () => {
    const usuario = userEvent.setup()
    const repo: Repositorio = {
      ...criarRepositorioFixture(),
      fazerCheckin: () => Promise.reject(new Error('Você está a 2,3 km da etapa. O check-in só vale até 1 km.')),
    }
    renderizarApp('/', repo)
    await usuario.click(await screen.findByRole('button', { name: 'Fazer check-in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Você está a 2,3 km da etapa')
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeEnabled()
  })

  it('erro de localização: mostra a mensagem, oferece os ajustes e não chama o servidor', async () => {
    const usuario = userEvent.setup()
    const ajustes = vi.fn()
    mocks.obterPosicao.mockRejectedValue(
      new ErroLocalizacao('permissao', 'Permita o acesso à localização para fazer o check-in.', ajustes),
    )
    const fixture = criarRepositorioFixture()
    const fazerCheckin = vi.fn(fixture.fazerCheckin)
    renderizarApp('/', { ...fixture, fazerCheckin })
    await usuario.click(await screen.findByRole('button', { name: 'Fazer check-in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permita o acesso à localização para fazer o check-in.')
    await usuario.click(screen.getByRole('button', { name: 'Abrir ajustes de localização' }))
    expect(ajustes).toHaveBeenCalled()
    expect(fazerCheckin).not.toHaveBeenCalled()
  })

  it('mostra "Obtendo localização…" enquanto espera o GPS', async () => {
    const usuario = userEvent.setup()
    let liberar: (p: Posicao) => void = () => {}
    mocks.obterPosicao.mockReturnValue(new Promise<Posicao>((r) => (liberar = r)))
    renderizarApp('/')
    await usuario.click(await screen.findByRole('button', { name: 'Fazer check-in' }))
    expect(await screen.findByRole('button', { name: 'Obtendo localização…' })).toBeDisabled()
    liberar(POSICAO)
    expect(await screen.findByText('CP TESTE (você)')).toBeInTheDocument()
  })

  it('etapa sem localização cadastrada: aviso e check-in desabilitado', async () => {
    const fixture = criarRepositorioFixture()
    const repo: Repositorio = {
      ...fixture,
      equipeServico: async (id) => ({ ...(await fixture.equipeServico(id)), tem_localizacao: false }),
    }
    renderizarApp('/', repo)
    expect(
      await screen.findByText('A localização da etapa não está cadastrada; o check-in fica indisponível.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeDisabled()
  })

  it('sem conexão: botões desabilitados e aviso', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderizarApp('/')
    expect(await screen.findByText('Sem conexão')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeDisabled()
  })
})

describe('Supabase: equipe de serviço', () => {
  const ID = ETAPA_2.id
  const equipeBruta = {
    etapa_id: ID,
    participa: true,
    tem_localizacao: true,
    meu_servico: { id: 's1', etapa_id: ID, etapa_nome: '2ª ETAPA', entrada_em: '2026-01-05T11:00:00Z' },
    equipe: [
      { id: 's1', usuario_id: 'u1', nome: 'CP PATRICIO', entrada_em: '2026-01-05T11:00:00Z', saida_em: null, saida_automatica: false, eu: true },
    ],
  }

  function cliente(data: unknown, error: unknown = null) {
    return { rpc: vi.fn().mockResolvedValue({ data, error }) }
  }

  it('etapasInicio e equipeServico chamam as RPCs e leem o retorno', async () => {
    const c = cliente([{ id: ID, slug: '2a', nome: '2ª ETAPA', ordem: 2, participa: true }])
    const repo = criarRepositorioSupabase(c as never)
    expect(await repo.etapasInicio()).toEqual([{ id: ID, slug: '2a', nome: '2ª ETAPA', ordem: 2, participa: true }])
    expect(c.rpc).toHaveBeenCalledWith('etapas_inicio')

    const c2 = cliente(equipeBruta)
    const equipe = await criarRepositorioSupabase(c2 as never).equipeServico(ID)
    expect(c2.rpc).toHaveBeenCalledWith('equipe_servico', { p_etapa: ID })
    expect(equipe.meu_servico?.etapa_nome).toBe('2ª ETAPA')
    expect(equipe.equipe[0]).toMatchObject({ nome: 'CP PATRICIO', eu: true, saida_em: null })
  })

  it('fazerCheckin manda a posição; fazerCheckout não manda nada', async () => {
    const c = cliente(equipeBruta)
    const repo = criarRepositorioSupabase(c as never)
    await repo.fazerCheckin(ID, POSICAO)
    expect(c.rpc).toHaveBeenCalledWith('fazer_checkin', {
      p_etapa: ID,
      p_latitude: POSICAO.latitude,
      p_longitude: POSICAO.longitude,
      p_precisao: 12,
    })
    await repo.fazerCheckout()
    expect(c.rpc).toHaveBeenLastCalledWith('fazer_checkout')
  })

  it('erros do servidor viram ErroEnvio com a mensagem do banco', async () => {
    const msg = 'Você está a 2,3 km da etapa. O check-in só vale até 1 km.'
    const repo = criarRepositorioSupabase(cliente(null, { code: 'P0001', message: msg }) as never)
    await expect(repo.fazerCheckin(ID, POSICAO)).rejects.toMatchObject({ message: msg })
    const repo2 = criarRepositorioSupabase(
      cliente(null, { code: '23505', message: 'Você já está de serviço na 3ª ETAPA' }) as never,
    )
    await expect(repo2.fazerCheckin(ID, POSICAO)).rejects.toMatchObject({ tipo: 'conflito' })
  })
})

describe('fixture: equipe de serviço', () => {
  it('não participa da 4ª etapa e recusa o check-in lá', async () => {
    const repo = criarRepositorioFixture()
    expect((await repo.etapasInicio()).find((e) => e.id === ETAPA_4.id)?.participa).toBe(false)
    await expect(repo.fazerCheckin(ETAPA_4.id, POSICAO)).rejects.toMatchObject({ tipo: 'permissao' })
  })

  it('um serviço aberto por vez', async () => {
    const repo = criarRepositorioFixture()
    await repo.fazerCheckin(ETAPA_2.id, POSICAO)
    await expect(repo.fazerCheckin(ETAPA_3.id, POSICAO)).rejects.toMatchObject({ tipo: 'conflito' })
    const equipe = await repo.fazerCheckout()
    expect(equipe.etapa_id).toBe(ETAPA_2.id)
    await expect(repo.fazerCheckout()).rejects.toMatchObject({ tipo: 'nao_encontrado' })
  })
})
