/**
 * Armazenamento local (IndexedDB) dos registros ainda não enviados e do cache
 * de consultas. Fotos ficam como ArrayBuffer (o WebKit tem bugs antigos com
 * blobs no IndexedDB). Sem IndexedDB, cai para a memória.
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import type { TipoErroEnvio } from '../dados/erros.ts'
import type { TipoRegistro } from '../dados/tipos.ts'

export interface RegistroLocal {
  id: string // = Rascunho.id
  usuarioId: string
  obra: { id: string; slug: string; nome: string }
  ambiente: { id: string; codigo: string; nome: string }
  tipo: TipoRegistro
  legenda: string
  capturadoEm: string // ISO
  criadoEm: string // ISO; ordem da fila
  fotos: { id: string; largura: number; altura: number; bytes: number }[] // na ordem escolhida
  /** Falha definitiva; enquanto não for nula, a fila não tenta sozinha. */
  erro: { tipo: TipoErroEnvio; mensagem: string } | null
}

/**
 * Encerramento de pendência ainda não enviado. As fotos ficam no mesmo store
 * `fotos`, com `registroId = id do encerramento` (o caminho no Storage usa o
 * id da pendência, `pendenciaId`, e é montado só no envio).
 */
export interface EncerramentoLocal {
  id: string // id do encerramento (gerado no cliente)
  usuarioId: string
  obra: { id: string; slug: string; nome: string }
  ambiente: { id: string; codigo: string; nome: string }
  /** Id da pendência encerrada. */
  pendenciaId: string
  /** Legenda da pendência, para mostrar na lista. */
  legenda: string
  observacao: string
  criadoEm: string // ISO; ordem da fila
  fotos: { id: string; largura: number; altura: number; bytes: number }[]
  /** Falha definitiva; enquanto não for nula, a fila não tenta sozinha. */
  erro: { tipo: TipoErroEnvio; mensagem: string } | null
}

export interface CacheSalvo {
  versao: number
  salvoEm: number
  estado: unknown // DehydratedState
}

export class ErroArmazenamento extends Error {
  readonly tipo: 'cota' | 'indisponivel'
  constructor(tipo: 'cota' | 'indisponivel', message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes)
    this.name = 'ErroArmazenamento'
    this.tipo = tipo
  }
}

export const MENSAGEM_COTA =
  'Sem espaço no aparelho para guardar este registro. Libere espaço e tente de novo.'
const MENSAGEM_INDISPONIVEL = 'Não foi possível guardar o registro no aparelho.'
const FOLGA_COTA_BYTES = 1024 * 1024

export interface Armazenamento {
  /** false quando o IndexedDB não está disponível e os dados ficam só na memória. */
  readonly persistente: boolean
  /** Grava o registro e as fotos numa transação só. Lança ErroArmazenamento. */
  salvar(r: RegistroLocal, fotos: { id: string; dados: ArrayBuffer }[]): Promise<void>
  /** Atualiza só os metadados (por exemplo, `erro`). */
  atualizar(r: RegistroLocal): Promise<void>
  listar(usuarioId: string): Promise<RegistroLocal[]> // por criadoEm crescente
  lerFoto(registroId: string, fotoId: string): Promise<ArrayBuffer | undefined>
  remover(id: string): Promise<void> // registro (ou encerramento) e fotos numa transação
  lerCache(usuarioId: string): Promise<CacheSalvo | undefined>
  salvarCache(usuarioId: string, c: CacheSalvo): Promise<void>
  /** Grava o encerramento e as fotos numa transação só. Lança ErroArmazenamento. */
  salvarEncerramento(e: EncerramentoLocal, fotos: { id: string; dados: ArrayBuffer }[]): Promise<void>
  atualizarEncerramento(e: EncerramentoLocal): Promise<void>
  listarEncerramentos(usuarioId: string): Promise<EncerramentoLocal[]> // por criadoEm crescente
  /** Apaga o cache de consultas dos outros usuários; os registros deles ficam. */
  limparCachesExceto(usuarioId: string): Promise<void>
  fechar(): void
}

function porCriadoEm(a: { criadoEm: string }, b: { criadoEm: string }): number {
  return a.criadoEm.localeCompare(b.criadoEm)
}

function bytesDasFotos(fotos: { dados: ArrayBuffer }[]): number {
  return fotos.reduce((s, f) => s + f.dados.byteLength, 0)
}

export function criarArmazenamentoMemoria(): Armazenamento {
  const registros = new Map<string, RegistroLocal>()
  const fotos = new Map<string, ArrayBuffer>()
  const encerramentos = new Map<string, EncerramentoLocal>()
  const caches = new Map<string, CacheSalvo>()
  const chave = (r: string, f: string) => `${r}/${f}`

  return {
    persistente: false,
    async salvar(r, novas) {
      registros.set(r.id, structuredClone(r))
      for (const f of novas) fotos.set(chave(r.id, f.id), f.dados)
    },
    async atualizar(r) {
      registros.set(r.id, structuredClone(r))
    },
    async salvarEncerramento(e, novas) {
      encerramentos.set(e.id, structuredClone(e))
      for (const f of novas) fotos.set(chave(e.id, f.id), f.dados)
    },
    async atualizarEncerramento(e) {
      encerramentos.set(e.id, structuredClone(e))
    },
    async listarEncerramentos(usuarioId) {
      return [...encerramentos.values()]
        .filter((e) => e.usuarioId === usuarioId)
        .sort(porCriadoEm)
        .map((e) => structuredClone(e))
    },
    async listar(usuarioId) {
      return [...registros.values()]
        .filter((r) => r.usuarioId === usuarioId)
        .sort(porCriadoEm)
        .map((r) => structuredClone(r))
    },
    async lerFoto(registroId, fotoId) {
      return fotos.get(chave(registroId, fotoId))
    },
    async remover(id) {
      registros.delete(id)
      encerramentos.delete(id)
      for (const k of [...fotos.keys()]) if (k.startsWith(`${id}/`)) fotos.delete(k)
    },
    async lerCache(usuarioId) {
      return caches.get(usuarioId)
    },
    async salvarCache(usuarioId, c) {
      caches.set(usuarioId, c)
    },
    async limparCachesExceto(usuarioId) {
      for (const k of [...caches.keys()]) if (k !== usuarioId) caches.delete(k)
    },
    fechar() {},
  }
}

interface EsquemaDb extends DBSchema {
  registros: { key: string; value: RegistroLocal; indexes: { usuarioId: string } }
  encerramentos: { key: string; value: EncerramentoLocal; indexes: { usuarioId: string } }
  fotos: {
    key: [string, string]
    value: { registroId: string; fotoId: string; dados: ArrayBuffer }
    indexes: { registroId: string }
  }
  cache: { key: string; value: CacheSalvo & { usuarioId: string } }
}

function ehCota(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'QuotaExceededError'
  )
}

function erroDeGravacao(e: unknown): ErroArmazenamento {
  if (e instanceof ErroArmazenamento) return e
  if (ehCota(e)) return new ErroArmazenamento('cota', MENSAGEM_COTA, { cause: e })
  return new ErroArmazenamento('indisponivel', MENSAGEM_INDISPONIVEL, { cause: e })
}

function criarArmazenamentoIdb(db: IDBPDatabase<EsquemaDb>): Armazenamento {
  let pediuPersistencia = false

  async function espacoSuficiente(bytes: number): Promise<boolean> {
    try {
      const est = await navigator.storage?.estimate?.()
      if (!est || typeof est.quota !== 'number' || typeof est.usage !== 'number') return true
      return est.quota - est.usage >= bytes + FOLGA_COTA_BYTES
    } catch {
      return true
    }
  }

  function pedirPersistencia(): void {
    if (pediuPersistencia) return
    pediuPersistencia = true
    try {
      void Promise.resolve(navigator.storage?.persist?.()).catch(() => {})
    } catch {
      // Sem persistência garantida; segue.
    }
  }

  /** Grava o item (registro ou encerramento) e as fotos, que usam o id do item como `registroId`. */
  async function gravar(
    loja: 'registros' | 'encerramentos',
    item: RegistroLocal | EncerramentoLocal,
    fotos: { id: string; dados: ArrayBuffer }[],
  ): Promise<void> {
    if (!(await espacoSuficiente(bytesDasFotos(fotos)))) {
      throw new ErroArmazenamento('cota', MENSAGEM_COTA)
    }
    pedirPersistencia()
    let tx: IDBPTransaction<EsquemaDb, ['registros', 'encerramentos', 'fotos'], 'readwrite'> | undefined
    try {
      tx = db.transaction(['registros', 'encerramentos', 'fotos'], 'readwrite')
      void tx.done.catch(() => {}) // evita rejeição sem tratador quando abortamos
      const pedidos: Promise<unknown>[] = [
        loja === 'registros'
          ? tx.objectStore('registros').put(item as RegistroLocal)
          : tx.objectStore('encerramentos').put(item as EncerramentoLocal),
      ]
      for (const f of fotos) {
        pedidos.push(
          tx.objectStore('fotos').put({ registroId: item.id, fotoId: f.id, dados: f.dados }),
        )
      }
      // `tx.done` rejeita no abort (inclusive por QuotaExceededError).
      await Promise.all([...pedidos, tx.done])
    } catch (e) {
      try {
        tx?.abort()
      } catch {
        // Já concluída ou abortada.
      }
      throw erroDeGravacao(e)
    }
  }

  return {
    persistente: true,

    salvar: (r, fotos) => gravar('registros', r, fotos),
    salvarEncerramento: (e, fotos) => gravar('encerramentos', e, fotos),
    async atualizarEncerramento(e) {
      try {
        await db.put('encerramentos', e)
      } catch (erro) {
        throw erroDeGravacao(erro)
      }
    },
    async listarEncerramentos(usuarioId) {
      const lista = await db.getAllFromIndex('encerramentos', 'usuarioId', usuarioId)
      return lista.sort(porCriadoEm)
    },
    async atualizar(r) {
      try {
        await db.put('registros', r)
      } catch (e) {
        throw erroDeGravacao(e)
      }
    },

    async listar(usuarioId) {
      const lista = await db.getAllFromIndex('registros', 'usuarioId', usuarioId)
      return lista.sort(porCriadoEm)
    },

    async lerFoto(registroId, fotoId) {
      return (await db.get('fotos', [registroId, fotoId]))?.dados
    },

    async remover(id) {
      const tx = db.transaction(['registros', 'encerramentos', 'fotos'], 'readwrite')
      const concluida = tx.done
      await tx.objectStore('registros').delete(id)
      await tx.objectStore('encerramentos').delete(id)
      const indice = tx.objectStore('fotos').index('registroId')
      let cursor = await indice.openCursor(IDBKeyRange.only(id))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await concluida
    },

    async lerCache(usuarioId) {
      const c = await db.get('cache', usuarioId)
      if (!c) return undefined
      return { versao: c.versao, salvoEm: c.salvoEm, estado: c.estado }
    },

    async salvarCache(usuarioId, c) {
      await db.put('cache', { ...c, usuarioId })
    },

    async limparCachesExceto(usuarioId) {
      const tx = db.transaction('cache', 'readwrite')
      const concluida = tx.done
      for (const k of await tx.store.getAllKeys()) {
        if (k !== usuarioId) await tx.store.delete(k)
      }
      await concluida
    },

    fechar() {
      db.close()
    },
  }
}

/** Abre uma conexão nova a cada chamada (sem guardar em variável de módulo). */
export async function abrirArmazenamento(): Promise<Armazenamento> {
  if (typeof indexedDB === 'undefined') return criarArmazenamentoMemoria()
  try {
    const db = await openDB<EsquemaDb>('diario-obra', 2, {
      upgrade(banco, versaoAnterior) {
        if (versaoAnterior < 1) {
          const registros = banco.createObjectStore('registros', { keyPath: 'id' })
          registros.createIndex('usuarioId', 'usuarioId')
          const fotos = banco.createObjectStore('fotos', { keyPath: ['registroId', 'fotoId'] })
          fotos.createIndex('registroId', 'registroId')
          banco.createObjectStore('cache', { keyPath: 'usuarioId' })
        }
        // Versão 2 (fase 7): encerramentos de pendência, sem mexer nos dados da versão 1.
        if (versaoAnterior < 2) {
          const encerramentos = banco.createObjectStore('encerramentos', { keyPath: 'id' })
          encerramentos.createIndex('usuarioId', 'usuarioId')
        }
      },
    })
    return criarArmazenamentoIdb(db)
  } catch {
    return criarArmazenamentoMemoria()
  }
}
