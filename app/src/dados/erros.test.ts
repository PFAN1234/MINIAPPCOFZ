import { afterEach, describe, expect, it, vi } from 'vitest'
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
  function respostaHttp(status: number, erro: string) {
    return {
      name: 'FunctionsHttpError',
      context: new Response(JSON.stringify({ erro }), { status }),
    }
  }
  /** `invoke` responde em sequência; `fetch` é o PUT no R2. */
  function cliente(
    invoke: unknown[],
    rpc: unknown,
    put: () => Promise<Response> = async () => new Response(null, { status: 200 }),
  ) {
    const chamarFunction = vi.fn(async () => invoke.shift())
    const chamar = vi.fn(async () => rpc)
    const http = vi.fn(put)
    vi.stubGlobal('fetch', http)
    const fake = { functions: { invoke: chamarFunction }, rpc: chamar }
    return { fake, chamarFunction, chamar, http }
  }
  afterEach(() => vi.unstubAllGlobals())
  const PERMITIDO = {
    data: {
      situacao: 'enviar',
      url: 'https://r2.test/put?x=1',
      cabecalhos: { 'content-type': 'image/jpeg' },
    },
    error: null,
  }
  const CONFIRMADO = { data: { situacao: 'confirmado' }, error: null }
  const dados = {
    id: REG,
    ambienteId: OBRA,
    tipo: 'pendencia' as const,
    legenda: 'x',
    capturadoEm: '2026-11-09T10:00:00.000Z',
    fotos: [{ id: FOTO, largura: 1, altura: 1, bytes: 1 }],
  }

  it('monta o caminho a partir dos ids e envia como image/jpeg pela function', async () => {
    const { fake, chamarFunction, http } = cliente([PERMITIDO, CONFIRMADO], {
      data: null,
      error: null,
    })
    const repo = criarRepositorioSupabase(fake as never)
    const blob = new Blob(['x'])
    await repo.enviarFoto({ obraId: OBRA, registroId: REG, fotoId: FOTO }, blob)
    expect(chamarFunction).toHaveBeenNthCalledWith(1, 'armazenamento', {
      body: {
        acao: 'enviar',
        pasta: 'fotos',
        caminho: `${OBRA}/${REG}/${FOTO}.jpg`,
        tamanho: 1,
        tipo: 'image/jpeg',
      },
    })
    expect(http).toHaveBeenCalledWith(
      'https://r2.test/put?x=1',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(chamarFunction).toHaveBeenNthCalledWith(2, 'armazenamento', {
      body: {
        acao: 'confirmar',
        pasta: 'fotos',
        caminho: `${OBRA}/${REG}/${FOTO}.jpg`,
      },
    })
  })

  it('foto já confirmada no servidor conta como enviada', async () => {
    const { fake, http } = cliente([{ data: { situacao: 'ja_confirmado' }, error: null }], null)
    await expect(
      criarRepositorioSupabase(fake as never).enviarFoto(
        { obraId: OBRA, registroId: REG, fotoId: FOTO },
        new Blob(['x']),
      ),
    ).resolves.toBeUndefined()
    expect(http).not.toHaveBeenCalled()
  })

  it('recusa ids que não são UUID antes de montar o caminho', async () => {
    const { fake, chamarFunction } = cliente([], { data: null, error: null })
    const repo = criarRepositorioSupabase(fake as never)
    await expect(
      repo.enviarFoto({ obraId: OBRA, registroId: '../x', fotoId: FOTO }, new Blob(['x'])),
    ).rejects.toMatchObject({ tipo: 'validacao' })
    expect(chamarFunction).not.toHaveBeenCalled()
  })

  it('sem_permissao da function e falha de rede no PUT viram ErroEnvio', async () => {
    const perm = cliente([{ data: null, error: respostaHttp(403, 'sem_permissao') }], null)
    await expect(
      criarRepositorioSupabase(perm.fake as never).enviarFoto(
        { obraId: OBRA, registroId: REG, fotoId: FOTO },
        new Blob(['x']),
      ),
    ).rejects.toMatchObject({ tipo: 'permissao' })

    const rede = cliente([PERMITIDO], null, async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      criarRepositorioSupabase(rede.fake as never).enviarFoto(
        { obraId: OBRA, registroId: REG, fotoId: FOTO },
        new Blob(['x']),
      ),
    ).rejects.toMatchObject({ tipo: 'rede' })
  })

  it('chama a RPC com os parâmetros p_* e devolve o id', async () => {
    const { fake, chamar } = cliente([], { data: { id: REG }, error: null })
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
    const { fake } = cliente([], {
      data: null,
      error: {
        code: '22023',
        message: 'A legenda deve ter de 1 a 1000 caracteres',
      },
    })
    await expect(
      criarRepositorioSupabase(fake as never).concluirRegistro(dados),
    ).rejects.toMatchObject({
      tipo: 'validacao',
      message: 'A legenda deve ter de 1 a 1000 caracteres',
    })
  })
})
