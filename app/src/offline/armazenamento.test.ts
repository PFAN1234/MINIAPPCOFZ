import { openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abrirArmazenamento,
  criarArmazenamentoMemoria,
  ErroArmazenamento,
  MENSAGEM_COTA,
  type Armazenamento,
  type EncerramentoLocal,
  type RegistroLocal,
} from './armazenamento.ts'

function registro(id: string, usuarioId = 'u1', criadoEm = '2026-11-09T10:00:00.000Z'): RegistroLocal {
  return {
    id,
    usuarioId,
    obra: { id: 'o1', slug: 'hto', nome: 'HTO' },
    ambiente: { id: 'a1', codigo: 'apto-101', nome: 'Apto. 101' },
    tipo: 'pendencia',
    legenda: 'Teste',
    capturadoEm: '2026-11-09T09:00:00.000Z',
    criadoEm,
    fotos: [
      { id: 'f1', largura: 10, altura: 10, bytes: 4 },
      { id: 'f2', largura: 10, altura: 10, bytes: 4 },
    ],
    erro: null,
  }
}

function buffer(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

const fotos = () => [
  { id: 'f1', dados: buffer(1, 2, 3, 4) },
  { id: 'f2', dados: buffer(5, 6, 7, 8) },
]

function definirStorage(valor: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
  Object.defineProperty(navigator, 'storage', { configurable: true, value: valor })
  return () => {
    if (original) Object.defineProperty(navigator, 'storage', original)
    else delete (navigator as unknown as Record<string, unknown>).storage
  }
}

describe.each([
  ['IndexedDB', () => abrirArmazenamento(), true],
  ['memória', () => Promise.resolve(criarArmazenamentoMemoria()), false],
])('armazenamento (%s)', (_nome, abrir, persistente) => {
  async function com(fn: (a: Armazenamento) => Promise<void>) {
    const a = await abrir()
    try {
      await fn(a)
    } finally {
      a.fechar()
    }
  }

  it('informa se é persistente', () =>
    com(async (a) => {
      expect(a.persistente).toBe(persistente)
    }))

  it('grava e lista por usuário, por criadoEm crescente', () =>
    com(async (a) => {
      await a.salvar(registro('b', 'u1', '2026-11-09T11:00:00.000Z'), fotos())
      await a.salvar(registro('a', 'u1', '2026-11-09T10:00:00.000Z'), fotos())
      await a.salvar(registro('c', 'u2'), fotos())
      expect((await a.listar('u1')).map((r) => r.id)).toEqual(['a', 'b'])
      expect((await a.listar('u2')).map((r) => r.id)).toEqual(['c'])
      expect(await a.listar('u3')).toEqual([])
    }))

  it('guarda as fotos à parte e remover apaga registro e fotos', () =>
    com(async (a) => {
      await a.salvar(registro('a'), fotos())
      await a.salvar(registro('b'), fotos())
      expect(new Uint8Array((await a.lerFoto('a', 'f2'))!)).toEqual(new Uint8Array([5, 6, 7, 8]))
      await a.remover('a')
      expect((await a.listar('u1')).map((r) => r.id)).toEqual(['b'])
      expect(await a.lerFoto('a', 'f1')).toBeUndefined()
      expect(await a.lerFoto('a', 'f2')).toBeUndefined()
      expect(await a.lerFoto('b', 'f1')).toBeDefined()
    }))

  it('atualizar muda só os metadados', () =>
    com(async (a) => {
      const r = registro('a')
      await a.salvar(r, fotos())
      await a.atualizar({ ...r, erro: { tipo: 'validacao', mensagem: 'ruim' } })
      expect((await a.listar('u1'))[0].erro).toEqual({ tipo: 'validacao', mensagem: 'ruim' })
      expect(await a.lerFoto('a', 'f1')).toBeDefined()
    }))

  it('limparCachesExceto apaga os caches dos outros e preserva os registros', () =>
    com(async (a) => {
      await a.salvar(registro('a', 'u1'), fotos())
      await a.salvar(registro('c', 'u2'), fotos())
      await a.salvarCache('u1', { versao: 1, salvoEm: 1, estado: { x: 1 } })
      await a.salvarCache('u2', { versao: 1, salvoEm: 2, estado: { x: 2 } })
      await a.limparCachesExceto('u1')
      expect(await a.lerCache('u1')).toEqual({ versao: 1, salvoEm: 1, estado: { x: 1 } })
      expect(await a.lerCache('u2')).toBeUndefined()
      expect(await a.listar('u2')).toHaveLength(1)
    }))
})

describe('armazenamento IndexedDB: cota e falhas', () => {
  afterEach(() => vi.restoreAllMocks())

  it('recusa por cota quando o estimate indica pouco espaço, sem gravar', async () => {
    const restaurar = definirStorage({
      estimate: async () => ({ quota: 2_000_000, usage: 1_500_000 }),
      persist: async () => true,
    })
    const a = await abrirArmazenamento()
    try {
      const grande = [{ id: 'f1', dados: new ArrayBuffer(600_000) }]
      await expect(a.salvar(registro('a'), grande)).rejects.toMatchObject({
        name: 'ErroArmazenamento',
        tipo: 'cota',
        message: MENSAGEM_COTA,
      })
      expect(await a.listar('u1')).toEqual([])
    } finally {
      a.fechar()
      restaurar()
    }
  })

  it('aceita quando há espaço e pede persistência uma vez', async () => {
    const persist = vi.fn(async () => true)
    const restaurar = definirStorage({
      estimate: async () => ({ quota: 100_000_000, usage: 1_000 }),
      persist,
    })
    const a = await abrirArmazenamento()
    try {
      await a.salvar(registro('a'), fotos())
      await a.salvar(registro('b'), fotos())
      expect(persist).toHaveBeenCalledTimes(1)
      expect(await a.listar('u1')).toHaveLength(2)
    } finally {
      a.fechar()
      restaurar()
    }
  })

  it('QuotaExceededError na gravação vira ErroArmazenamento cota', async () => {
    const a = await abrirArmazenamento()
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError')
    })
    try {
      await expect(a.salvar(registro('a'), fotos())).rejects.toMatchObject({
        tipo: 'cota',
        message: MENSAGEM_COTA,
      })
    } finally {
      a.fechar()
    }
  })

  it('outros erros de IDB viram indisponivel', async () => {
    const a = await abrirArmazenamento()
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quebrou', 'UnknownError')
    })
    try {
      const e = await a.salvar(registro('a'), fotos()).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(ErroArmazenamento)
      expect(e).toMatchObject({
        tipo: 'indisponivel',
        message: 'Não foi possível guardar o registro no aparelho.',
      })
    } finally {
      a.fechar()
    }
  })

  it('sem IndexedDB, abrirArmazenamento cai para a memória', async () => {
    vi.stubGlobal('indexedDB', undefined)
    try {
      expect((await abrirArmazenamento()).persistente).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('se o openDB falhar, cai para a memória', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect((await abrirArmazenamento()).persistente).toBe(false)
  })
})


function encerramento(id: string, usuarioId = 'u1', criadoEm = '2026-11-10T10:00:00.000Z'): EncerramentoLocal {
  return {
    id,
    usuarioId,
    obra: { id: 'o1', slug: 'hto', nome: 'HTO' },
    ambiente: { id: 'a1', codigo: 'apto-101', nome: 'Apto. 101' },
    pendenciaId: 'p1',
    legenda: 'Tomada sem espelho',
    observacao: 'Refeito',
    criadoEm,
    fotos: [{ id: 'f1', largura: 10, altura: 10, bytes: 4 }],
    erro: null,
  }
}

describe.each([
  ['IndexedDB', () => abrirArmazenamento()],
  ['memória', () => Promise.resolve(criarArmazenamentoMemoria())],
])('armazenamento de encerramentos (%s)', (_nome, abrir) => {
  async function com(fn: (a: Armazenamento) => Promise<void>) {
    const a = await abrir()
    try {
      await fn(a)
    } finally {
      a.fechar()
    }
  }

  it('salva com as fotos, lista por usuário em ordem de criação e atualiza o erro', () =>
    com(async (a) => {
      await a.salvarEncerramento(encerramento('e2', 'u1', '2026-11-10T11:00:00.000Z'), [
        { id: 'f1', dados: buffer(1, 2) },
      ])
      await a.salvarEncerramento(encerramento('e1'), [{ id: 'f1', dados: buffer(3, 4) }])
      await a.salvarEncerramento(encerramento('e3', 'u2'), [])
      expect((await a.listarEncerramentos('u1')).map((e) => e.id)).toEqual(['e1', 'e2'])
      expect(await a.lerFoto('e1', 'f1')).toEqual(buffer(3, 4))
      // Encerramentos não aparecem na lista de registros.
      expect(await a.listar('u1')).toEqual([])

      await a.atualizarEncerramento({
        ...encerramento('e1'),
        erro: { tipo: 'conflito', mensagem: 'Esta pendência já foi encerrada.' },
      })
      expect((await a.listarEncerramentos('u1'))[0].erro?.tipo).toBe('conflito')
    }))

  it('remover apaga o encerramento e as fotos, sem mexer nos registros', () =>
    com(async (a) => {
      await a.salvar(registro('r1'), fotos())
      await a.salvarEncerramento(encerramento('e1'), [{ id: 'f1', dados: buffer(3, 4) }])
      await a.remover('e1')
      expect(await a.listarEncerramentos('u1')).toEqual([])
      expect(await a.lerFoto('e1', 'f1')).toBeUndefined()
      expect(await a.listar('u1')).toHaveLength(1)
      expect(await a.lerFoto('r1', 'f1')).toBeDefined()
    }))
})

describe('IndexedDB: migração da versão 1 para a 2', () => {
  it('preserva registros, fotos e cache e cria o store de encerramentos', async () => {
    const v1 = await openDB('diario-obra', 1, {
      upgrade(banco) {
        const registros = banco.createObjectStore('registros', { keyPath: 'id' })
        registros.createIndex('usuarioId', 'usuarioId')
        const fotosStore = banco.createObjectStore('fotos', { keyPath: ['registroId', 'fotoId'] })
        fotosStore.createIndex('registroId', 'registroId')
        banco.createObjectStore('cache', { keyPath: 'usuarioId' })
      },
    })
    await v1.put('registros', registro('antigo'))
    await v1.put('fotos', { registroId: 'antigo', fotoId: 'f1', dados: buffer(9, 9) })
    await v1.put('cache', { usuarioId: 'u1', versao: 1, salvoEm: 5, estado: { x: 1 } })
    v1.close()

    const a = await abrirArmazenamento()
    try {
      expect((await a.listar('u1')).map((r) => r.id)).toEqual(['antigo'])
      expect(await a.lerFoto('antigo', 'f1')).toEqual(buffer(9, 9))
      expect(await a.lerCache('u1')).toEqual({ versao: 1, salvoEm: 5, estado: { x: 1 } })
      expect(await a.listarEncerramentos('u1')).toEqual([])
      await a.salvarEncerramento(encerramento('novo'), [{ id: 'f1', dados: buffer(1) }])
      expect(await a.listarEncerramentos('u1')).toHaveLength(1)
    } finally {
      a.fechar()
    }
  })
})
