import type {
  CategoriaTotal,
  Corte,
  FiltroAtributo,
  GrupoPropriedades,
  Medida,
  NoArvore,
  Ponto3,
  Projecao,
  RefElemento,
  Vista,
} from '../../domain/central.ts'

export type TemaCentral = 'escuro' | 'claro'
export type EventoMotor = 'selecao' | 'medicao' | 'marcador'

/**
 * Porta do motor 3D da Central de modelos. O adaptador (That Open + three) fica em
 * `infra/thatopen/`; a tela só conhece esta interface. Métodos de etapas futuras lançam
 * "não implementado (etapa N)" no adaptador até a etapa indicada no contrato.
 */
export interface MotorVisualizador {
  montar(el: HTMLElement, tema: TemaCentral): Promise<void>
  /** Troca o tema (fundo e grade) sem remontar o motor. */
  tema(tema: TemaCentral): void
  /** Carrega as disciplinas. Rejeita com `ErroCarregamento` (siglas falhas) só no fim; as demais ficam carregadas. */
  carregar(modelos: { sigla: string; dados: Uint8Array }[], progresso: (fracao: number) => void): Promise<void>
  descarregar(sigla: string): void
  arvore(): Promise<NoArvore[]>
  categorias(): Promise<CategoriaTotal[]>
  propriedades(ref: RefElemento): Promise<GrupoPropriedades[]>
  buscar(filtro: FiltroAtributo): Promise<RefElemento[]>
  selecionar(refs: RefElemento[]): void
  ocultar(refs: RefElemento[]): void
  isolar(refs: RefElemento[]): void
  mostrarTudo(): void
  fantasma(ligado: boolean): void
  colorirPor(modo: 'nenhum' | 'categoria' | 'disciplina'): void
  enquadrar(refs?: RefElemento[]): void
  projecao(p: Projecao): void
  vistaPlanta(pavimento: string): void
  vistaElevacao(lado: 'N' | 'S' | 'L' | 'O'): void
  vista3d(): void
  caminhar(ligado: boolean): void
  cortes: { criar(): void; apagar(id?: string): void; listar(): Corte[] }
  medir: {
    modo(m: 'distancia' | 'area' | 'volume' | 'angulo' | null): void
    listar(): Medida[]
    apagar(id?: string): void
  }
  vistaAtual(): Vista
  aplicarVista(v: Vista): Promise<void>
  capturar(): Promise<Blob>
  marcadores(itens: { id: string; posicao: Ponto3; rotulo: string }[]): void
  /** Assina um evento; `selecao` entrega `RefElemento[]`. Devolve a função que cancela. */
  ao(evento: EventoMotor, cb: (dados: unknown) => void): () => void
  /** Libera tudo (WebGL, worker, listeners). Depois disso o motor não serve mais. */
  liberar(): void
}

/** Fábrica injetada pelo composition root (carrega o adaptador sob demanda). */
export type FabricaMotor = () => Promise<MotorVisualizador>
