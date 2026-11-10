import { describe, expect, it, vi } from 'vitest'
import { ErroEnvio, erroDoSupabase, MENSAGEM_REDE } from './erros.ts'
import { criarRepositorioSupabase } from './supabase.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const REG = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02'
const FOTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e03'

describe('erroDoSupabase', () => {
  it.each([
    ['28000', 'sessao'],
    ['42501', 'permissao'],
    ['P0002', 'nao_encontrado'],
    ['23505', 'conflito'],
    ['22023', 'validacao'],
  ] as const)('código %s vira %s com a mensagem do servidor', (code, tipo) => {
    const e = erroDoSupabase({ code, message: 'Mensagem do servidor' })
    expect(e).toBeInstanceOf(ErroEnvio)
    expect(e.tipo).toBe(tipo)
    expect(e.message).toBe('Mensagem do servidor')
  })

  it('falha de rede (TypeError ou mensagem de fetch) vira rede', () => {
    expect(erroDoSupabase(new TypeError('Failed to fetch')).tipo).toBe('rede')
    expect(erroDoSupabase({ message: 'TypeError: Load failed', code: '' }).tipo).toBe('rede')
    expect(erroDoSupabase({ message: 'x', originalError: new TypeError('x') }).message).toBe(
      MENSAGEM_REDE,
    )
  })

  it('erro de RLS do Storage (403 ou 400 com mensagem) vira permissao', () => {
    expect(erroDoSupabase({ statusCode: '403', message: 'Unauthorized' }).tipo).toBe('permissao')
    expect(
      erroDoSupabase({
        statusCode: '400',
        message: 'new row violates row-level security policy',
      }).tipo,
    ).toBe('permissao')
  })

  it('JWT expirado ou 401 vira sessao; resto vira desconhecido', () => {
    expect(erroDoSupabase({ code: 'PGRST301', message: 'JWT expired' }).tipo).toBe('sessao')
    expect(erroDoSupabase({ status: 401, message: 'x' }).tipo).toBe('sessao')
    expect(erroDoSupabase({ code: '99999', message: 'estranho' }).tipo).toBe('desconhecido')
  })

  it('mantém um ErroEnvio existente', () => {
    const e = new ErroEnvio('conflito', 'x')
    expect(erroDoSupabase(e)).toBe(e)
  })
})

describe('repositório Supabase: envio', () => {
  function cliente(upload: unknown, rpc: unknown) {
    const subir = vi.fn(async () => upload)
    const chamar = vi.fn(async () => rpc)
    const fake = {
      storage: { from: vi.fn(() => ({ upload: subir })) },
      rpc: chamar,
    }
    return { fake, subir, chamar }
  }
  const dados = {
    id: REG,
    ambienteId: OBRA,
    tipo: 'pendencia' as const,
    legenda: 'x',
    capturadoEm: '2026-11-09T10:00:00.000Z',
    fotos: [{ id: FOTO, largura: 1, altura: 1, bytes: 1 }],
  }

  it('monta o caminho a partir dos ids e faz upsert como image/jpeg', async () => {
    const { fake, subir } = cliente({ error: null }, { data: null, error: null })
    const repo = criarRepositorioSupabase(fake as never)
    const blob = new Blob(['x'])
    await repo.enviarFoto({ obraId: OBRA, registroId: REG, fotoId: FOTO }, blob)
    expect(fake.storage.from).toHaveBeenCalledWith('fotos')
    expect(subir).toHaveBeenCalledWith(`${OBRA}/${REG}/${FOTO}.jpg`, blob, {
      upsert: true,
      contentType: 'image/jpeg',
    })
  })

  it('recusa ids que não são UUID antes de montar o caminho', async () => {
    const { fake, subir } = cliente({ error: null }, { data: null, error: null })
    const repo = criarRepositorioSupabase(fake as never)
    await expect(
      repo.enviarFoto({ obraId: OBRA, registroId: '../x', fotoId: FOTO }, new Blob(['x'])),
    ).rejects.toMatchObject({ tipo: 'validacao' })
    expect(subir).not.toHaveBeenCalled()
  })

  it('erro de RLS e falha de rede no upload viram ErroEnvio', async () => {
    const rls = cliente(
      { error: { statusCode: '403', message: 'new row violates row-level security policy' } },
      null,
    )
    await expect(
      criarRepositorioSupabase(rls.fake as never).enviarFoto(
        { obraId: OBRA, registroId: REG, fotoId: FOTO },
        new Blob(['x']),
      ),
    ).rejects.toMatchObject({ tipo: 'permissao' })

    const rede = cliente(null, null)
    rede.subir.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      criarRepositorioSupabase(rede.fake as never).enviarFoto(
        { obraId: OBRA, registroId: REG, fotoId: FOTO },
        new Blob(['x']),
      ),
    ).rejects.toMatchObject({ tipo: 'rede' })
  })

  it('chama a RPC com os parâmetros p_* e devolve o id', async () => {
    const { fake, chamar } = cliente(null, { data: { id: REG }, error: null })
    const r = await criarRepositorioSupabase(fake as never).concluirRegistro(dados)
    expect(r).toEqual({ id: REG })
    expect(chamar).toHaveBeenCalledWith('concluir_registro', {
      p_id: REG,
      p_ambiente_id: OBRA,
      p_tipo: 'pendencia',
      p_legenda: 'x',
      p_capturado_em: dados.capturadoEm,
      p_fotos: dados.fotos,
    })
  })

  it('erros da RPC viram ErroEnvio com tipo e mensagem do servidor', async () => {
    const { fake } = cliente(null, {
      data: null,
      error: { code: '22023', message: 'A legenda deve ter de 1 a 1000 caracteres' },
    })
    await expect(
      criarRepositorioSupabase(fake as never).concluirRegistro(dados),
    ).rejects.toMatchObject({
      tipo: 'validacao',
      message: 'A legenda deve ter de 1 a 1000 caracteres',
    })
  })
})
