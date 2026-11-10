/**
 * Envio de um registro (fotos + RPC), idempotente e retomável: os ids são
 * gerados uma única vez em `criarRascunho`, e repetir `enviarRegistro` com o
 * mesmo rascunho nunca duplica nada.
 */
import type { FotoPreparada } from '../util/imagem.ts'
import { ErroEnvio } from './erros.ts'
import type { Repositorio } from './repositorio.ts'
import type { TipoRegistro } from './tipos.ts'

export interface Rascunho {
  id: string
  obraId: string
  ambienteId: string
  tipo: TipoRegistro
  legenda: string
  /** ISO. */
  capturadoEm: string
  fotos: FotoPreparada[]
}

export interface Progresso {
  enviadas: number
  total: number
}

export const MAXIMO_SIMULTANEOS = 2

/** Gera o id do registro (uma única vez); reutilize o rascunho ao tentar de novo. */
export function criarRascunho(dados: Omit<Rascunho, 'id'>): Rascunho {
  return { id: crypto.randomUUID(), ...dados }
}

/** Sobe as fotos (até `MAXIMO_SIMULTANEOS` por vez) para `<obra>/<registro>/<foto>.jpg`. */
async function enviarFotos(
  repo: Repositorio,
  obraId: string,
  registroId: string,
  fotos: FotoPreparada[],
  aoProgredir?: (p: Progresso) => void,
): Promise<void> {
  const total = fotos.length
  let enviadas = 0
  let proxima = 0
  let falha: unknown = null
  aoProgredir?.({ enviadas, total })

  async function trabalhador(): Promise<void> {
    while (falha === null && proxima < total) {
      const foto = fotos[proxima++]
      try {
        await repo.enviarFoto({ obraId, registroId, fotoId: foto.id }, foto.blob)
      } catch (e) {
        // Retomada: erro de permissão no reenvio indica foto já vinculada a um
        // registro concluído antes. Segue para a RPC, que devolve o registro
        // existente ou, se a permissão for mesmo negada, propaga o erro dela.
        if (!(e instanceof ErroEnvio && e.tipo === 'permissao')) {
          falha ??= e
          return
        }
      }
      enviadas++
      aoProgredir?.({ enviadas, total })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAXIMO_SIMULTANEOS, total) }, () => trabalhador()),
  )
  if (falha !== null) throw falha
}

export async function enviarRegistro(
  repo: Repositorio,
  r: Rascunho,
  aoProgredir?: (p: Progresso) => void,
): Promise<void> {
  await enviarFotos(repo, r.obraId, r.id, r.fotos, aoProgredir)
  await repo.concluirRegistro({
    id: r.id,
    ambienteId: r.ambienteId,
    tipo: r.tipo,
    legenda: r.legenda,
    capturadoEm: r.capturadoEm,
    fotos: r.fotos.map((f) => ({ id: f.id, largura: f.largura, altura: f.altura, bytes: f.bytes })),
  })
}

export interface RascunhoEncerramento {
  /** Id do encerramento. */
  id: string
  /** Id da pendência encerrada. */
  registroId: string
  obraId: string
  observacao: string
  fotos: FotoPreparada[]
}

/** Gera o id do encerramento (uma única vez); reutilize o rascunho ao tentar de novo. */
export function criarRascunhoEncerramento(
  dados: Omit<RascunhoEncerramento, 'id'>,
): RascunhoEncerramento {
  return { id: crypto.randomUUID(), ...dados }
}

/** Fotos em `<obra>/<pendência>/<foto>.jpg` e depois `encerrar_pendencia`; idempotente como `enviarRegistro`. */
export async function enviarEncerramento(
  repo: Repositorio,
  e: RascunhoEncerramento,
  aoProgredir?: (p: Progresso) => void,
): Promise<void> {
  await enviarFotos(repo, e.obraId, e.registroId, e.fotos, aoProgredir)
  await repo.encerrarPendencia({
    id: e.id,
    registroId: e.registroId,
    obraId: e.obraId,
    observacao: e.observacao,
    fotos: e.fotos.map((f) => ({ id: f.id, largura: f.largura, altura: f.altura, bytes: f.bytes })),
  })
}
