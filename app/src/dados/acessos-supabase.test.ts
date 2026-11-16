import { describe, expect, it, vi } from 'vitest'
import { ErroEnvio } from './erros.ts'
import { criarRepositorioSupabase } from './supabase.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const USUARIO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a02'

function cliente(rpcResposta: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResposta),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } } }) },
  }
}

describe('Supabase: acessos da equipe', () => {
  it('matrizAcessos converte visto_em em vistoEm e completa os campos', async () => {
    const fake = cliente({
      error: null,
      data: {
        obras: [{ id: OBRA, slug: 'hto', nome: 'HTO' }],
        pessoas: [
          { id: USUARIO, nome: 'Marcos', username: null, admin: true, visto_em: '2026-11-15T10:00:00Z', acessos: { [OBRA]: 'gestor' }, pedidos: [OBRA] },
          { id: 'x', nome: 'Sem dados', username: 'sd', admin: false, visto_em: null, acessos: {}, pedidos: [] },
        ],
      },
    })
    const m = await criarRepositorioSupabase(fake as never).matrizAcessos()
    expect(fake.rpc).toHaveBeenCalledWith('matriz_acessos', {})
    expect(m.obras).toEqual([{ id: OBRA, slug: 'hto', nome: 'HTO' }])
    expect(m.pessoas[0]).toEqual({
      id: USUARIO,
      nome: 'Marcos',
      username: null,
      admin: true,
      vistoEm: '2026-11-15T10:00:00Z',
      acessos: { [OBRA]: 'gestor' },
      pedidos: [OBRA],
    })
    expect(m.pessoas[1].vistoEm).toBeNull()
    expect(m.pessoas[1].username).toBe('sd')
  })

  it('definirAcesso chama a RPC e converte o erro', async () => {
    const fake = cliente({ error: null, data: null })
    await criarRepositorioSupabase(fake as never).definirAcesso(OBRA, USUARIO, 'equipe')
    expect(fake.rpc).toHaveBeenCalledWith('definir_acesso', { p_obra: OBRA, p_usuario: USUARIO, p_papel: 'equipe' })

    const falha = cliente({ error: { code: '42501', message: 'Só gestores alteram acessos.' }, data: null })
    await expect(criarRepositorioSupabase(falha as never).definirAcesso(OBRA, USUARIO, 'nenhum')).rejects.toBeInstanceOf(ErroEnvio)
  })
})
