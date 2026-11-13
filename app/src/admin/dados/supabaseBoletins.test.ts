import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioAdminSupabase, listaBoletinsDe } from './supabase.ts'

function clienteFalso(rpc: (nome: string, args: unknown) => { data: unknown; error: unknown }) {
  const assinar = vi.fn(async (caminho: string, segundos: number) => ({
    data: { signedUrl: `https://sb/assinada/${caminho}?s=${segundos}` },
    error: null,
  }))
  const cliente = {
    rpc: vi.fn(async (nome: string, args: unknown) => rpc(nome, args)),
    storage: { from: vi.fn(() => ({ createSignedUrl: assinar })) },
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt-do-admin' } } })) },
  }
  return { cliente: cliente as unknown as SupabaseClient, falso: cliente, assinar }
}

afterEach(() => vi.unstubAllGlobals())

describe('repositório Supabase: boletins', () => {
  it('lê {boletins, pedidos} (e aceita só a lista)', () => {
    const r = listaBoletinsDe({
      boletins: [
        {
          id: 'b1',
          data: '2026-11-13',
          revisao: 1,
          numero: 'BA2/261113/COFZ-R1',
          emitido_em: '2026-11-14T10:00:00Z',
          emitido_por_nome: 'CP PATRICIO',
          pdf_path: 'e/BA2261113COFZ-R1.pdf',
          publicado: true,
        },
      ],
      pedidos: [{ id: 7, data: '2026-11-12', revisao: 0, estado: 'falhou', tentativas: 8, erro: 'x', atualizado_em: 'agora' }],
    })
    expect(r.boletins[0]).toMatchObject({ revisao: 1, emitido_por_nome: 'CP PATRICIO', publicado: true })
    expect(r.pedidos[0]).toEqual({ id: 7, data: '2026-11-12', revisao: 0, estado: 'falhou', tentativas: 8, erro: 'x', atualizado_em: 'agora' })
    expect(listaBoletinsDe([{ id: 'b', data: '2026-11-13', numero: 'N', emitido_em: 'x' }]).boletins[0]).toMatchObject({
      revisao: 0,
      emitido_por_nome: null,
      pdf_path: null,
      publicado: false,
    })
    expect(listaBoletinsDe(null)).toEqual({ boletins: [], pedidos: [] })
  })

  it('chama as RPCs e assina a URL do PDF no bucket boletins', async () => {
    const { cliente, falso, assinar } = clienteFalso((nome) =>
      nome === 'admin_pedir_emissao'
        ? { data: { id: 3, data: '2026-11-13', revisao: 0, estado: 'pendente' }, error: null }
        : { data: { boletins: [], pedidos: [] }, error: null },
    )
    const repo = criarRepositorioAdminSupabase(cliente)
    expect(await repo.listarBoletins('2a-etapa')).toEqual({ boletins: [], pedidos: [] })
    expect(falso.rpc).toHaveBeenCalledWith('admin_listar_boletins', { p_slug: '2a-etapa' })
    expect(await repo.pedirEmissao('2a-etapa', '2026-11-13')).toMatchObject({ id: 3, estado: 'pendente' })
    expect(falso.rpc).toHaveBeenCalledWith('admin_pedir_emissao', { p_slug: '2a-etapa', p_data: '2026-11-13' })
    expect(await repo.urlPdfBoletim('e/x.pdf')).toBe('https://sb/assinada/e/x.pdf?s=300')
    expect(falso.storage.from).toHaveBeenCalledWith('boletins')
    expect(assinar).toHaveBeenCalledWith('e/x.pdf', 300)
  })

  it('lê publicacao_erro e publicacao_tentativas (padrão: null e 0)', () => {
    const [a, b] = listaBoletinsDe([
      { id: 'a', data: '2026-11-13', numero: 'N', emitido_em: 'x', publicacao_erro: 'chat not found', publicacao_tentativas: 3 },
      { id: 'b', data: '2026-11-13', numero: 'N', emitido_em: 'x' },
    ]).boletins
    expect([a.publicacao_erro, a.publicacao_tentativas]).toEqual(['chat not found', 3])
    expect([b.publicacao_erro, b.publicacao_tentativas]).toEqual([null, 0])
  })

  it('reenviar chama admin_reenviar_boletim; erro vira mensagem', async () => {
    const { cliente, falso } = clienteFalso(() => ({ data: { boletim_id: 'b1', publicacao_estado: 'pendente' }, error: null }))
    await criarRepositorioAdminSupabase(cliente).reenviarBoletim('2a-etapa', 'b1')
    expect(falso.rpc).toHaveBeenCalledWith('admin_reenviar_boletim', { p_slug: '2a-etapa', p_boletim: 'b1' })
    const { cliente: ruim } = clienteFalso(() => ({
      data: null,
      error: { code: '22023', message: 'Este boletim já foi publicado no grupo' },
    }))
    await expect(criarRepositorioAdminSupabase(ruim).reenviarBoletim('2a-etapa', 'b1')).rejects.toThrow('já foi publicado')
  })

  it('pedido repetido (23505) vira mensagem em português', async () => {
    const { cliente } = clienteFalso(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "boletim_emissao_unico"' },
    }))
    await expect(criarRepositorioAdminSupabase(cliente).pedirEmissao('2a-etapa', '2026-11-13')).rejects.toThrow(
      'Já existe um pedido de emissão em andamento para esta data',
    )
  })

  it('prévia: GET /api/previa-boletim com o JWT do admin; erro do gerador vira mensagem', async () => {
    const { cliente } = clienteFalso(() => ({ data: null, error: null }))
    const repo = criarRepositorioAdminSupabase(cliente)
    const fetch = vi.fn(async () => new Response('%PDF', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
    vi.stubGlobal('fetch', fetch)
    const pdf = await repo.previaBoletim('2a-etapa', '2026-11-13')
    expect(await pdf.text()).toBe('%PDF')
    expect(fetch).toHaveBeenCalledWith('/api/previa-boletim?etapa=2a-etapa&data=2026-11-13', {
      headers: { Authorization: 'Bearer jwt-do-admin' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ erro: 'Etapa não encontrada' }, { status: 404 })))
    await expect(repo.previaBoletim('x', '2026-11-13')).rejects.toThrow('Etapa não encontrada')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('falha', { status: 500 })))
    await expect(repo.previaBoletim('x', '2026-11-13')).rejects.toThrow('Não foi possível gerar a prévia')
  })
})
