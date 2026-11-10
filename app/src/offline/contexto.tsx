/**
 * Provedor do modo sem sinal: abre o armazenamento do aparelho, restaura o
 * cache de consultas, cria a fila de envio e a mantém ligada enquanto o app
 * estiver aberto. Os hooks abaixo dão às telas o estado da fila, os registros
 * locais e as fotos guardadas no aparelho.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { EstadoCarregando, EstadoErro } from '../components/Estado.tsx'
import { useRepositorio } from '../dados/contexto.tsx'
import type { TipoRegistro } from '../dados/tipos.ts'
import { abrirArmazenamento, type Armazenamento } from './armazenamento.ts'
import { persistirCache, restaurarCache } from './cacheConsultas.ts'
import { criarFila, type EstadoFila, type Fila, type ItemFila } from './fila.ts'

interface Pronto {
  usuarioId: string
  fila: Fila
  armazenamento: Armazenamento
}

const Contexto = createContext<Pronto | null>(null)

export function OfflineProvider({ children }: { children: ReactNode }) {
  const repo = useRepositorio()
  const qc = useQueryClient()
  const usuario = useQuery({
    queryKey: ['usuario'],
    queryFn: () => repo.idUsuario(),
    networkMode: 'always',
  })
  const usuarioId = usuario.data ?? null
  const [pronto, setPronto] = useState<Pronto | null>(null)

  useEffect(() => {
    if (!usuarioId) return
    let cancelado = false
    let desligar: (() => void) | null = null

    void (async () => {
      const armazenamento = await abrirArmazenamento()
      if (cancelado) {
        armazenamento.fechar()
        return
      }
      await restaurarCache(qc, armazenamento, usuarioId)
      if (cancelado) {
        armazenamento.fechar()
        return
      }
      const cancelarCache = persistirCache(qc, armazenamento, usuarioId)
      const fila = criarFila({
        repo,
        armazenamento,
        usuarioId,
        aoEnviar: async (r) => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['registros'] }),
            qc.invalidateQueries({ queryKey: ['obras'] }),
            qc.invalidateQueries({ queryKey: ['obra', r.obra.slug] }),
            qc.invalidateQueries({ queryKey: ['ambiente', r.obra.slug, r.ambiente.codigo] }),
          ])
        },
      })
      const parar = fila.iniciar()
      desligar = () => {
        parar()
        cancelarCache()
        armazenamento.fechar()
      }
      setPronto({ usuarioId, fila, armazenamento })
    })()

    return () => {
      cancelado = true
      desligar?.()
    }
  }, [repo, qc, usuarioId])

  if (usuario.isError || (usuario.isSuccess && !usuarioId)) {
    return (
      <EstadoErro
        mensagem="Não foi possível identificar o usuário."
        onTentarDeNovo={() => void usuario.refetch()}
      />
    )
  }
  if (!usuarioId || !pronto || pronto.usuarioId !== usuarioId) return <EstadoCarregando />
  return <Contexto.Provider value={pronto}>{children}</Contexto.Provider>
}

function usePronto(): Pronto {
  const p = useContext(Contexto)
  if (!p) throw new Error('Hook de fila usado fora de OfflineProvider')
  return p
}

export interface UsoFila {
  estado: EstadoFila
  adicionar: Fila['adicionar']
  sincronizar: Fila['sincronizar']
  tentarDeNovo: Fila['tentarDeNovo']
  descartar: Fila['descartar']
}

export function useFila(): UsoFila {
  const { fila } = usePronto()
  const estado = useSyncExternalStore(fila.assinar, fila.obterEstado)
  return useMemo(
    () => ({
      estado,
      adicionar: fila.adicionar,
      sincronizar: fila.sincronizar,
      tentarDeNovo: fila.tentarDeNovo,
      descartar: fila.descartar,
    }),
    [estado, fila],
  )
}

export interface FiltroLocais {
  obraId?: string
  ambienteId?: string
  tipo?: TipoRegistro
}

/** Registros guardados no aparelho que ainda não foram enviados, do mais recente ao mais antigo. */
export function useRegistrosLocais(filtro: FiltroLocais = {}): ItemFila[] {
  const { estado } = useFila()
  const { obraId, ambienteId, tipo } = filtro
  return useMemo(
    () =>
      estado.itens.filter(
        (i) =>
          (!obraId || i.registro.obra.id === obraId) &&
          (!ambienteId || i.registro.ambiente.id === ambienteId) &&
          (!tipo || i.registro.tipo === tipo),
      ),
    [estado.itens, obraId, ambienteId, tipo],
  )
}

/** URLs de objeto das fotos guardadas no aparelho (na ordem de `fotoIds`); revogadas ao desmontar. */
export function useFotosLocais(registroId: string, fotoIds: string[]): (string | undefined)[] {
  const { armazenamento } = usePronto()
  const chave = `${registroId}|${fotoIds.join(',')}`
  const [lidas, setLidas] = useState<{ chave: string; urls: (string | undefined)[] } | null>(null)

  useEffect(() => {
    let ativo = true
    const criadas: string[] = []
    void (async () => {
      const urls: (string | undefined)[] = []
      for (const fotoId of fotoIds) {
        try {
          const dados = await armazenamento.lerFoto(registroId, fotoId)
          if (dados && typeof URL.createObjectURL === 'function') {
            const url = URL.createObjectURL(new Blob([dados], { type: 'image/jpeg' }))
            criadas.push(url)
            urls.push(url)
          } else {
            urls.push(undefined)
          }
        } catch {
          urls.push(undefined)
        }
      }
      if (ativo) setLidas({ chave, urls })
      else for (const u of criadas) URL.revokeObjectURL?.(u)
    })()
    return () => {
      ativo = false
      for (const u of criadas) URL.revokeObjectURL?.(u)
    }
    // `chave` resume registroId e fotoIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armazenamento, chave])

  return lidas?.chave === chave ? lidas.urls : fotoIds.map(() => undefined)
}

/** URL de objeto de uma foto guardada no aparelho (ou undefined enquanto lê). */
export function useFotoLocal(registroId: string, fotoId: string): string | undefined {
  const ids = useMemo(() => [fotoId], [fotoId])
  return useFotosLocais(registroId, ids)[0]
}
