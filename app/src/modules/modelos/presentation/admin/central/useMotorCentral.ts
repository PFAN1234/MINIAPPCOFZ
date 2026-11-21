import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useRepositorioAdmin } from '../../../../../admin/dados/contexto.tsx'
import type { MotorVisualizador, TemaCentral } from '../../../application/ports/MotorVisualizador.port.ts'
import { ErroCarregamento, progressoAgregado, type RefElemento } from '../../../domain/central.ts'
import { ordenarPorReferencia, type ModeloFrag } from '../../../domain/modelos.ts'
import { modeloComCache } from '../../../infra/cacheModelo.ts'
import { temWebGL } from '../../../infra/modelosLocais.ts'
import { useFabricaMotor } from './motorContexto.tsx'

export type FaseCentral = 'sem-webgl' | 'preparando' | 'carregando' | 'pronto' | 'vazio' | 'erro'

export interface EstadoCentral {
  fase: FaseCentral
  /** 0..1 (download + carga). */
  progresso: number
  /** Siglas que não baixaram ou não carregaram. */
  falhas: string[]
  erro: string | null
  /** Modelos publicados da obra. */
  modelos: ModeloFrag[]
  /** Siglas hoje no visualizador. */
  ativos: string[]
  /** Muda a cada carga/descarga: painéis que leem a árvore e as categorias recarregam. */
  versao: number
  selecao: RefElemento[]
  motor: MotorVisualizador | null
  alternarModelo(sigla: string, ligado: boolean): Promise<void>
  /** Depois de publicar ou retirar: relê a lista e troca a disciplina na cena (ou remonta, se não há motor). */
  recarregarModelo(sigla: string): Promise<void>
  selecionar(refs: RefElemento[]): void
}

function texto(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao
}

/** Monta o motor 3D no elemento, baixa e carrega os modelos publicados da obra e entrega o estado à tela. */
export function useMotorCentral(slug: string, tema: TemaCentral, tela: RefObject<HTMLElement | null>): EstadoCentral {
  const repo = useRepositorioAdmin()
  const fabrica = useFabricaMotor()
  const [fase, setFase] = useState<FaseCentral>(() => (temWebGL() ? 'preparando' : 'sem-webgl'))
  const [progresso, setProgresso] = useState(0)
  const [falhas, setFalhas] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [modelos, setModelos] = useState<ModeloFrag[]>([])
  const [ativos, setAtivos] = useState<string[]>([])
  const [versao, setVersao] = useState(0)
  const [selecao, setSelecao] = useState<RefElemento[]>([])
  const [motor, setMotor] = useState<MotorVisualizador | null>(null)
  const temaRef = useRef(tema)
  const [rodada, setRodada] = useState(0)
  const motorRef = useRef<MotorVisualizador | null>(null)
  const ativosRef = useRef<string[]>([])
  useEffect(() => {
    ativosRef.current = ativos
  }, [ativos])

  const baixar = useCallback(
    async (m: ModeloFrag) => new Uint8Array(await modeloComCache(`${slug}/${m.sigla}@${m.hash}`, () => repo.baixarModelo(slug, m))),
    [repo, slug],
  )

  useEffect(() => {
    const el = tela.current
    if (!el || !temWebGL()) return
    let cancelado = false
    let local: MotorVisualizador | null = null
    let desassinar: (() => void) | null = null

    void (async () => {
      try {
        const lista = ordenarPorReferencia(await repo.listarModelos(slug))
        if (cancelado) return
        setModelos(lista)
        setFalhas([])
        setAtivos([])
        setErro(null)
        if (lista.length === 0) {
          setFase('vazio')
          return
        }
        const m = await fabrica()
        local = m
        await m.montar(el, temaRef.current)
        if (cancelado) return
        motorRef.current = m
        desassinar = m.ao('selecao', (d) => setSelecao(Array.isArray(d) ? (d as RefElemento[]) : []))
        setMotor(m)
        setFase('carregando')

        const falhou: string[] = []
        const prontos: { sigla: string; dados: Uint8Array }[] = []
        for (const [i, mod] of lista.entries()) {
          try {
            prontos.push({ sigla: mod.sigla, dados: await baixar(mod) })
          } catch {
            falhou.push(mod.sigla)
          }
          if (cancelado) return
          setProgresso(progressoAgregado([{ peso: 1, fracao: (i + 1) / lista.length }, { peso: 1, fracao: 0 }]) )
        }
        try {
          await m.carregar(prontos, (f) =>
            !cancelado && setProgresso(progressoAgregado([{ peso: 1, fracao: 1 }, { peso: 1, fracao: f }])),
          )
        } catch (e) {
          if (e instanceof ErroCarregamento) falhou.push(...e.siglas)
          else throw e
        }
        if (cancelado) return
        const ok = prontos.map((p) => p.sigla).filter((s) => !falhou.includes(s))
        setFalhas(falhou)
        setAtivos(ok)
        setVersao((v) => v + 1)
        m.enquadrar()
        if (ok.length === 0) {
          setErro(`Nenhuma disciplina carregou (${falhou.join(', ')}).`)
          setFase('erro')
        } else {
          setFase('pronto')
        }
      } catch (e) {
        if (cancelado) return
        setErro(texto(e, 'Não foi possível abrir os modelos.'))
        setFase('erro')
      }
    })()

    return () => {
      cancelado = true
      desassinar?.()
      motorRef.current = null
      local?.liberar()
      setMotor(null)
    }
    // O tema entra por ref: trocá-lo não remonta o motor.
  }, [slug, repo, fabrica, baixar, tela, rodada])

  useEffect(() => {
    temaRef.current = tema
    motorRef.current?.tema(tema)
  }, [tema])

  const alternarModelo = useCallback(
    async (sigla: string, ligado: boolean) => {
      const m = motorRef.current
      if (!m) return
      if (!ligado) {
        m.descarregar(sigla)
        setAtivos((a) => a.filter((s) => s !== sigla))
        setVersao((v) => v + 1)
        return
      }
      const mod = modelos.find((x) => x.sigla === sigla)
      if (!mod) return
      try {
        await m.carregar([{ sigla, dados: await baixar(mod) }], () => undefined)
        setFalhas((f) => f.filter((s) => s !== sigla))
        setAtivos((a) => (a.includes(sigla) ? a : [...a, sigla]))
      } catch (e) {
        setFalhas((f) => (f.includes(sigla) ? f : [...f, sigla]))
        if (!(e instanceof ErroCarregamento)) setErro(texto(e, `Falha ao carregar ${sigla}.`))
      }
      setVersao((v) => v + 1)
    },
    [baixar, modelos],
  )

  const recarregarModelo = useCallback(
    async (sigla: string) => {
      const lista = ordenarPorReferencia(await repo.listarModelos(slug))
      setModelos(lista)
      const m = motorRef.current
      if (!m || lista.length === 0) {
        // Sem motor (vazio ou erro) ou sem nada publicado: refaz a montagem inteira.
        setFase(temWebGL() ? 'preparando' : 'sem-webgl')
        setProgresso(0)
        setRodada((r) => r + 1)
        return
      }
      if (ativosRef.current.includes(sigla)) {
        m.descarregar(sigla)
        setAtivos((a) => a.filter((s) => s !== sigla))
      }
      const mod = lista.find((x) => x.sigla === sigla)
      if (mod) {
        try {
          await m.carregar([{ sigla, dados: await baixar(mod) }], () => undefined)
          setFalhas((f) => f.filter((s) => s !== sigla))
          setAtivos((a) => (a.includes(sigla) ? a : [...a, sigla]))
        } catch (e) {
          setFalhas((f) => (f.includes(sigla) ? f : [...f, sigla]))
          if (!(e instanceof ErroCarregamento)) setErro(texto(e, `Falha ao carregar ${sigla}.`))
        }
      } else {
        setFalhas((f) => f.filter((s) => s !== sigla))
      }
      setVersao((v) => v + 1)
    },
    [repo, slug, baixar],
  )

  const selecionar = useCallback((refs: RefElemento[]) => {
    motorRef.current?.selecionar(refs)
    setSelecao(refs)
  }, [])

  return { fase, progresso, falhas, erro, modelos, ativos, versao, selecao, motor, alternarModelo, recarregarModelo, selecionar }
}
