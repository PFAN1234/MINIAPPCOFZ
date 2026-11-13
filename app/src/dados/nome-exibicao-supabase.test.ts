import { describe, expect, it, vi } from 'vitest'
import { nomeMostrado } from './nome.ts'
import { criarRepositorioSupabase } from './supabase.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const ETAPA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02'
const OBS = '00000000-0000-4000-8000-000000000501'

type Resultado = { data?: unknown; error?: unknown; count?: number | null }

/** Consulta falsa do supabase-js: todo método encadeia e o `await` devolve o resultado da tabela. */
function consulta(resultado: Resultado) {
  const final = { data: resultado.data ?? null, error: resultado.error ?? null, count: resultado.count ?? null }
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'is']) q[m] = vi.fn(() => q)
  q.maybeSingle = vi.fn(() => Promise.resolve(final))
  q.single = vi.fn(() => Promise.resolve(final))
  q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(final).then(ok, erro)
  return q as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof final>
}

function clienteFalso(tabelas: Record<string, Resultado>, rpc?: (nome: string, args: unknown) => Resultado) {
  const consultas: Record<string, ReturnType<typeof consulta>> = {}
  const fake = {
    from: vi.fn((tabela: string) => (consultas[tabela] = consulta(tabelas[tabela] ?? { data: [] }))),
    rpc: vi.fn((nome: string, args: unknown) => Promise.resolve({ data: null, error: null, ...rpc?.(nome, args) })),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
  }
  return { fake, consultas }
}

const linhaRegistro = (autor: unknown) => ({
  id: '00000000-0000-4000-8000-000000000101',
  tipo: 'servico',
  situacao: null,
  legenda: 'Reboco',
  capturado_em: '2026-11-13T12:00:00Z',
  recebido_em: '2026-11-13T12:01:00Z',
  autor,
  ambiente: { id: 'a1', codigo: 'apto-101', nome_operacional: 'Apto. 101', pavimento: { nome: 'Térreo' } },
  obra: { id: OBRA, slug: 'hto', nome: 'HTO' },
})

describe('nomeMostrado', () => {
  it('usa o nome de exibição e, sem ele, o do Telegram', () => {
    expect(nomeMostrado({ nome: 'Patricio Ferreira', nome_exibicao: 'CP PATRICIO' })).toBe('CP PATRICIO')
    expect(nomeMostrado({ nome: 'Patricio Ferreira', nome_exibicao: null })).toBe('Patricio Ferreira')
    expect(nomeMostrado({ nome: 'Patricio Ferreira', nome_exibicao: '  ' })).toBe('Patricio Ferreira')
    expect(nomeMostrado({ nome: '' })).toBeNull()
    expect(nomeMostrado(null)).toBeNull()
  })
})

describe('Supabase: nome de exibição', () => {
  it('listarRegistros pede usuario(nome, nome_exibicao) e mostra o nome de exibição do autor', async () => {
    const { fake, consultas } = clienteFalso({
      registro: { data: [linhaRegistro({ nome: 'Patricio Ferreira', nome_exibicao: 'CP PATRICIO' })] },
    })
    const [r] = await criarRepositorioSupabase(fake as never).listarRegistros({})
    expect(String(consultas.registro.select.mock.calls[0][0])).toContain('autor:usuario(nome, nome_exibicao)')
    expect(r.autor).toBe('CP PATRICIO')
  })

  it('sem nome de exibição, o autor aparece pelo nome do Telegram', async () => {
    const { fake } = clienteFalso({
      registro: { data: [linhaRegistro({ nome: 'Maria Souza', nome_exibicao: null })] },
    })
    const [r] = await criarRepositorioSupabase(fake as never).listarRegistros({})
    expect(r.autor).toBe('Maria Souza')
  })

  it('obterPendencia mostra o autor e quem encerrou pelo nome de exibição', async () => {
    const { fake, consultas } = clienteFalso({
      registro: { data: { ...linhaRegistro({ nome: 'Ana', nome_exibicao: 'SGT ANA' }), tipo: 'pendencia' } },
      pavimento: { data: { codigo: 'terreo', nome: 'Térreo' } },
      participacao: { data: { papel: 'equipe' } },
      encerramento: {
        data: {
          id: 'enc-1',
          observacao: null,
          encerrado_em: '2026-11-13T13:00:00Z',
          gestor: { nome: 'Patricio Ferreira', nome_exibicao: 'CP PATRICIO' },
        },
      },
      publicacao_telegram: { data: [] },
      foto: { data: [] },
    })
    const p = await criarRepositorioSupabase(fake as never).obterPendencia('00000000-0000-4000-8000-000000000101')
    expect(String(consultas.encerramento.select.mock.calls[0][0])).toContain('gestor:usuario(nome, nome_exibicao)')
    expect(p?.registro.autor).toBe('SGT ANA')
    expect(p?.encerramento?.gestor).toBe('CP PATRICIO')
  })
})

describe('Supabase: observações do dia', () => {
  const linhaObs = {
    id: OBS,
    data: '2026-11-13',
    texto: 'Chuva forte',
    escrito_em: '2026-11-13T17:00:00Z',
    editado_em: null,
    autor: { id: 'u2', nome: 'CP PATRICIO' },
    minha: false,
    travada: true,
  }

  it('chama observacoes_do_dia e usa o dia, a trava e o fuso da etapa', async () => {
    const { fake } = clienteFalso(
      { obra: { data: { etapa_id: ETAPA, etapa: { fuso: 'America/Fortaleza' } } } },
      () => ({ data: [linhaObs] }),
    )
    const dia = await criarRepositorioSupabase(fake as never).observacoesDoDia(OBRA)
    expect(fake.rpc).toHaveBeenCalledWith('observacoes_do_dia', { p_obra: OBRA })
    expect(dia).toEqual({
      data: '2026-11-13',
      fuso: 'America/Fortaleza',
      travada: true,
      observacoes: [{ ...linhaObs }],
    })
    // Com observações, a trava vem da RPC: não consulta o boletim.
    expect(fake.from).not.toHaveBeenCalledWith('boletim')
  })

  it('dia sem observações confere o boletim da etapa no dia', async () => {
    const { fake, consultas } = clienteFalso(
      {
        obra: { data: { etapa_id: ETAPA, etapa: { fuso: 'America/Manaus' } } },
        boletim: { count: 1 },
      },
      () => ({ data: [] }),
    )
    const dia = await criarRepositorioSupabase(fake as never).observacoesDoDia(OBRA)
    expect(dia.observacoes).toEqual([])
    expect(dia.fuso).toBe('America/Manaus')
    expect(dia.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dia.travada).toBe(true)
    expect(consultas.boletim.eq).toHaveBeenCalledWith('etapa_id', ETAPA)
    expect(consultas.boletim.eq).toHaveBeenCalledWith('data', dia.data)
  })

  it('salvarObservacao envia {id, obra_id, texto, escrito_em} e devolve a observação como minha', async () => {
    const { fake } = clienteFalso({}, () => ({
      data: { ...linhaObs, obra_id: OBRA, minha: undefined, travada: undefined, autor: { id: 'u1', nome: 'EU' } },
    }))
    const r = await criarRepositorioSupabase(fake as never).salvarObservacao({
      id: OBS,
      obraId: OBRA,
      texto: 'Chuva forte',
      escritoEm: '2026-11-13T17:00:00Z',
    })
    expect(fake.rpc).toHaveBeenCalledWith('salvar_observacao', {
      p: { id: OBS, obra_id: OBRA, texto: 'Chuva forte', escrito_em: '2026-11-13T17:00:00Z' },
    })
    expect(r).toMatchObject({ id: OBS, minha: true, travada: false, autor: { id: 'u1', nome: 'EU' } })
  })

  it('erro 22023 da RPC sobe como ErroEnvio de validação com a mensagem do servidor', async () => {
    const mensagem = 'O boletim de 13/11/2026 já foi emitido; a correção é feita por retificação'
    const { fake } = clienteFalso({}, () => ({ error: { code: '22023', message: mensagem } }))
    await expect(
      criarRepositorioSupabase(fake as never).salvarObservacao({
        id: OBS,
        obraId: OBRA,
        texto: 'x',
        escritoEm: '2026-11-13T17:00:00Z',
      }),
    ).rejects.toMatchObject({ tipo: 'validacao', message: mensagem })
  })

  it('excluirObservacao chama excluir_observacao com o id', async () => {
    const { fake } = clienteFalso({})
    await criarRepositorioSupabase(fake as never).excluirObservacao(OBS)
    expect(fake.rpc).toHaveBeenCalledWith('excluir_observacao', { p_id: OBS })
  })
})
