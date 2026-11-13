import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioSupabase } from './supabase.ts'

const ETAPA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02'

function cliente(rpcResposta: { data: unknown; error: unknown }, token: string | null = 'jwt-x') {
  const assinar = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://u/pdf' }, error: null })
  const fake = {
    rpc: vi.fn().mockResolvedValue(rpcResposta),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: token ? { access_token: token } : null } }) },
    storage: { from: vi.fn(() => ({ createSignedUrl: assinar })) },
  }
  return { fake, assinar }
}

afterEach(() => vi.unstubAllGlobals())

describe('Supabase: relatórios', () => {
  it('mapeia listar_relatorios', async () => {
    const { fake } = cliente({
      error: null,
      data: {
        admin: true,
        etapas: [
          {
            id: ETAPA, slug: '2a-etapa', nome: '2ª ETAPA', sigla: null, horario: '18:00:00', hoje: '2026-11-13',
            registros_hoje: '3',
            boletim_hoje: { id: 'b1', numero: 'B-1', revisao: 0, emitido_em: '2026-11-13T21:00:00Z' },
            pedido_hoje: { estado: 'falhou', erro: 'x' },
          },
        ],
        boletins: [
          {
            id: 'b1', etapa_id: ETAPA, etapa_slug: '2a-etapa', etapa_nome: '2ª ETAPA', data: '2026-11-13', revisao: 0,
            numero: 'B-1', emitido_em: '2026-11-13T21:00:00Z', pdf_path: null, publicado: true, ultima_revisao: true,
          },
        ],
      },
    })
    const r = await criarRepositorioSupabase(fake as never).relatorios()
    expect(fake.rpc).toHaveBeenCalledWith('listar_relatorios', {})
    expect(r.admin).toBe(true)
    expect(r.etapas[0]).toMatchObject({
      sigla: null,
      horario: '18:00',
      registros_hoje: 3,
      boletim_hoje: { numero: 'B-1', revisao: 0 },
      pedido_hoje: { estado: 'falhou', erro: 'x' },
    })
    expect(r.boletins[0]).toMatchObject({ pdf_path: null, publicado: true, ultima_revisao: true })
  })

  it('URL assinada de 5 minutos no bucket boletins', async () => {
    const { fake, assinar } = cliente({ data: null, error: null })
    expect(await criarRepositorioSupabase(fake as never).urlPdfBoletim('a/b.pdf')).toBe('https://u/pdf')
    expect(fake.storage.from).toHaveBeenCalledWith('boletins')
    expect(assinar).toHaveBeenCalledWith('a/b.pdf', 300)
  })

  it('emitir chama admin_pedir_emissao; 23505 vira mensagem amigável', async () => {
    const { fake } = cliente({ data: {}, error: null })
    await criarRepositorioSupabase(fake as never).emitirBoletim('2a-etapa', '2026-11-13')
    expect(fake.rpc).toHaveBeenCalledWith('admin_pedir_emissao', { p_slug: '2a-etapa', p_data: '2026-11-13' })

    const dup = cliente({ data: null, error: { code: '23505', message: 'duplicate' } })
    await expect(criarRepositorioSupabase(dup.fake as never).emitirBoletim('2a-etapa', '2026-11-13')).rejects.toMatchObject({
      tipo: 'conflito',
      message: 'Já existe uma emissão em andamento para esta data.',
    })
  })

  it('excluir chama a Edge Function com o JWT e mapeia o resultado', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, numero: 'B-1', data: '2026-11-12', revisoes: 2, mensagens: { apagadas: 1, falhas: 0 } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchFalso)
    const { fake } = cliente({ data: null, error: null })
    const r = await criarRepositorioSupabase(fake as never).excluirBoletim('b1')
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/functions\/v1\/admin-excluir-obra$/)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-x')
    expect(JSON.parse(String(init.body))).toEqual({ acao: 'excluir_boletim', boletim_id: 'b1' })
    expect(r).toEqual({ numero: 'B-1', data: '2026-11-12', revisoes: 2, mensagens: { apagadas: 1, falhas: 0 }, arquivos_erro: null })
  })

  it('excluir: 409 e 403 viram ErroEnvio amigável; sem sessão pede login', async () => {
    const { fake } = cliente({ data: null, error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ erro: 'x' }), { status: 409 })))
    await expect(criarRepositorioSupabase(fake as never).excluirBoletim('b1')).rejects.toMatchObject({
      tipo: 'conflito',
      message: 'O boletim está sendo gerado ou enviado. Tente de novo em alguns minutos.',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })))
    await expect(criarRepositorioSupabase(fake as never).excluirBoletim('b1')).rejects.toMatchObject({ tipo: 'permissao' })
    const semSessao = cliente({ data: null, error: null }, null)
    await expect(criarRepositorioSupabase(semSessao.fake as never).excluirBoletim('b1')).rejects.toMatchObject({ tipo: 'sessao' })
  })
})
