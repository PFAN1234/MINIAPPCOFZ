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

export async function enviarRegistro(
  repo: Repositorio,
  r: Rascunho,
  aoProgredir?: (p: Progresso) => void,
): Promise<void> {
  const total = r.fotos.length
  let enviadas = 0
  let proxima = 0
  let falha: unknown = null
  aoProgredir?.({ enviadas, total })

  async function trabalhador(): Promise<void> {
    while (falha === null && proxima < total) {
      const foto = r.fotos[proxima++]
      try {
        await repo.enviarFoto({ obraId: r.obraId, registroId: r.id, fotoId: foto.id }, foto.blob)
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

  await repo.concluirRegistro({
    id: r.id,
    ambienteId: r.ambienteId,
    tipo: r.tipo,
    legenda: r.legenda,
    capturadoEm: r.capturadoEm,
    fotos: r.fotos.map((f) => ({ id: f.id, largura: f.largura, altura: f.altura, bytes: f.bytes })),
  })
}
