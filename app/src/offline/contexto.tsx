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
import { TelaDeEntrada } from '../components/FaixaIdentidade.tsx'
import { useRepositorio } from '../dados/contexto.tsx'
import type { SituacaoRegistro, TipoRegistro } from '../dados/tipos.ts'
import { dentroDoPeriodo } from '../util/periodo.ts'
import { abrirArmazenamento, type Armazenamento } from './armazenamento.ts'
import { persistirCache, restaurarCache } from './cacheConsultas.ts'
import {
  criarFila,
  type EstadoFila,
  type Fila,
  type ItemEncerramento,
  type ItemFila,
  type ItemObservacao,
} from './fila.ts'

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
            qc.invalidateQueries({ queryKey: ['resumo-obras'] }),
            qc.invalidateQueries({ queryKey: ['obras'] }),
            qc.invalidateQueries({ queryKey: ['obra', r.obra.slug] }),
            qc.invalidateQueries({ queryKey: ['ambiente', r.obra.slug, r.ambiente.codigo] }),
          ])
        },
        aoEncerrar: async (e) => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['registros'] }),
            qc.invalidateQueries({ queryKey: ['resumo-obras'] }),
            qc.invalidateQueries({ queryKey: ['pendencia'] }),
            qc.invalidateQueries({ queryKey: ['obras'] }),
            qc.invalidateQueries({ queryKey: ['obra', e.obra.slug] }),
            qc.invalidateQueries({ queryKey: ['ambiente', e.obra.slug, e.ambiente.codigo] }),
            qc.invalidateQueries({ queryKey: ['publicacoes-problema'] }),
          ])
        },
        aoObservar: async (o) => {
          await qc.invalidateQueries({ queryKey: ['observacoes', o.obra.id] })
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
      <TelaDeEntrada>
        <EstadoErro
          mensagem="Não foi possível identificar o usuário."
          onTentarDeNovo={() => void usuario.refetch()}
        />
      </TelaDeEntrada>
    )
  }
  if (!usuarioId || !pronto || pronto.usuarioId !== usuarioId) {
    return (
      <TelaDeEntrada>
        <EstadoCarregando />
      </TelaDeEntrada>
    )
  }
  return <Contexto.Provider value={pronto}>{children}</Contexto.Provider>
}

/** Id do usuário da sessão (para separar no aparelho o que é de cada um). */
export function useUsuarioId(): string {
  return usePronto().usuarioId
}

function usePronto(): Pronto {
  const p = useContext(Contexto)
  if (!p) throw new Error('Hook de fila usado fora de OfflineProvider')
  return p
}

export interface UsoFila {
  estado: EstadoFila
  adicionar: Fila['adicionar']
  adicionarEncerramento: Fila['adicionarEncerramento']
  adicionarObservacao: Fila['adicionarObservacao']
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
      adicionarEncerramento: fila.adicionarEncerramento,
      adicionarObservacao: fila.adicionarObservacao,
      sincronizar: fila.sincronizar,
      tentarDeNovo: fila.tentarDeNovo,
      descartar: fila.descartar,
    }),
    [estado, fila],
  )
}

export interface FiltroLocais {
  obraId?: string
  obraSlug?: string
  ambienteId?: string
  ambienteCodigo?: string
  tipo?: TipoRegistro
  /** Registro guardado no aparelho nunca está resolvido: `resolvida` não casa com nenhum. */
  situacao?: SituacaoRegistro
  /** Só obras destas (as de uma etapa). */
  obraIds?: string[]
  /** Só aparecem com o filtro vazio ou igual ao próprio usuário. */
  autorId?: string
  de?: string
  ate?: string
}

/** Registros guardados no aparelho que ainda não foram enviados, do mais recente ao mais antigo. */
export function useRegistrosLocais(filtro: FiltroLocais = {}): ItemFila[] {
  const { estado } = useFila()
  const { obraId, obraSlug, ambienteId, ambienteCodigo, tipo, situacao, obraIds, autorId, de, ate } = filtro
  const usuarioId = useUsuarioId()
  const chaveObras = obraIds?.join(',')
  return useMemo(
    () =>
      estado.itens.filter(
        (i) =>
          (!obraId || i.registro.obra.id === obraId) &&
          (!obraSlug || i.registro.obra.slug === obraSlug) &&
          (!ambienteId || i.registro.ambiente.id === ambienteId) &&
          (!ambienteCodigo || i.registro.ambiente.codigo === ambienteCodigo) &&
          (!tipo || i.registro.tipo === tipo) &&
          (!situacao || (i.registro.tipo === 'pendencia' && situacao === 'aberta')) &&
          (chaveObras === undefined || chaveObras.split(',').includes(i.registro.obra.id)) &&
          (!autorId || autorId === usuarioId) &&
          dentroDoPeriodo(i.registro.capturadoEm, de, ate),
      ),
    [estado.itens, obraId, obraSlug, ambienteId, ambienteCodigo, tipo, situacao, chaveObras, autorId, usuarioId, de, ate],
  )
}

/** Encerramento guardado no aparelho de uma pendência (ainda não enviado), se houver. */
export function useEncerramentoLocal(pendenciaId: string): ItemEncerramento | undefined {
  const { estado } = useFila()
  return estado.encerramentos.find((i) => i.encerramento.pendenciaId === pendenciaId)
}

/** Observações da obra guardadas no aparelho (ainda não enviadas), da mais antiga à mais recente. */
export function useObservacoesLocais(obraId: string): ItemObservacao[] {
  const { estado } = useFila()
  return useMemo(
    () => estado.observacoes.filter((i) => i.observacao.obra.id === obraId).reverse(),
    [estado.observacoes, obraId],
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
