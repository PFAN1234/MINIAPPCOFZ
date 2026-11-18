import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configurarEnvioErros, instalarCapturaGlobal, registrarErro, reiniciarErros } from './erros.ts'

function clienteFalso(sessao: boolean, rpc = vi.fn().mockResolvedValue({ error: null })) {
  const cliente = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: sessao ? {} : null } }) },
    rpc,
  }
  return { cliente: cliente as unknown as SupabaseClient, rpc }
}

beforeEach(() => {
  reiniciarErros()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('registrarErro', () => {
  it('envia mensagem, pilha, rota, versão, agente e contexto pela RPC', async () => {
    const { cliente, rpc } = clienteFalso(true)
    configurarEnvioErros(cliente, 'admin')
    await registrarErro(new Error('quebrou'), { componentStack: 'at X' })
    expect(rpc).toHaveBeenCalledTimes(1)
    const [nome, args] = rpc.mock.calls[0]
    expect(nome).toBe('registrar_erro_cliente')
    expect(args).toMatchObject({
      p_app: 'admin',
      p_mensagem: 'quebrou',
      p_contexto: { componentStack: 'at X' },
      p_agente: navigator.userAgent,
    })
    expect(args.p_pilha).toContain('quebrou')
    expect(args.p_rota).toBe(location.pathname + location.search)
  })

  it('não repete a mesma mensagem em 60 s, mas repete depois', async () => {
    const { cliente, rpc } = clienteFalso(true)
    configurarEnvioErros(cliente)
    await registrarErro(new Error('igual'))
    await registrarErro(new Error('igual'))
    expect(rpc).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(61_000)
    await registrarErro(new Error('igual'))
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('envia no máximo 10 por carregamento', async () => {
    const { cliente, rpc } = clienteFalso(true)
    configurarEnvioErros(cliente)
    for (let i = 0; i < 15; i++) await registrarErro(new Error(`erro ${i}`))
    expect(rpc).toHaveBeenCalledTimes(10)
  })

  it('nunca lança, mesmo se a RPC falhar', async () => {
    const { cliente } = clienteFalso(true, vi.fn().mockRejectedValue(new Error('rede')))
    configurarEnvioErros(cliente)
    await expect(registrarErro(new Error('x'))).resolves.toBeUndefined()
    const sem = { auth: { getSession: vi.fn().mockRejectedValue(new Error('y')) } } as unknown as SupabaseClient
    configurarEnvioErros(sem)
    await expect(registrarErro(new Error('z'))).resolves.toBeUndefined()
  })

  it('não envia sem sessão, sem cliente nem com a fixture (só console.error)', async () => {
    const sem = clienteFalso(false)
    configurarEnvioErros(sem.cliente)
    await registrarErro(new Error('a'))
    expect(sem.rpc).not.toHaveBeenCalled()

    configurarEnvioErros(null)
    await registrarErro(new Error('b'))

    const com = clienteFalso(true)
    configurarEnvioErros(com.cliente)
    vi.stubEnv('VITE_DADOS', 'fixture')
    await registrarErro(new Error('c'))
    expect(com.rpc).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledTimes(3)
  })
})

describe('instalarCapturaGlobal', () => {
  it('registra erros e promessas rejeitadas da janela, e desinstala', async () => {
    const { cliente, rpc } = clienteFalso(true)
    configurarEnvioErros(cliente)
    const remover = instalarCapturaGlobal('miniapp')
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('da janela'), message: 'da janela' }))
    const rejeicao = new Event('unhandledrejection') as Event & { reason: unknown }
    rejeicao.reason = new Error('promessa')
    window.dispatchEvent(rejeicao)
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc.mock.calls.map((c) => c[1].p_mensagem)).toEqual(['da janela', 'promessa'])
    remover()
    const silenciar = (e: Event) => e.preventDefault()
    window.addEventListener('error', silenciar)
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('depois'), message: 'depois', cancelable: true }))
    window.removeEventListener('error', silenciar)
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
