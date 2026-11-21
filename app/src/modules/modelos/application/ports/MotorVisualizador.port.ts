import type {
  CategoriaTotal,
  ModoCor,
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
export type EventoMotor = 'selecao' | 'medicao' | 'marcador' | 'cortes'

/**
 * Porta do motor 3D da Central de modelos. O adaptador (That Open + three) fica em
 * `infra/thatopen/`; a tela só conhece esta interface. Métodos de etapas futuras lançam
 * "não implementado (etapa N)" no adaptador até a etapa indicada no contrato.
 */
export interface MotorVisualizador {
  montar(el: HTMLElement, tema: TemaCentral): Promise<void>
  /** Troca o tema (fundo e grade) sem remontar o motor. */
  tema(tema: TemaCentral): void
  /** Mostra ou esconde a grade do piso. */
  grade(ligado: boolean): void
  /** Liga ou desliga o realce do item sob o cursor. */
  hover(ligado: boolean): void
  /** Carrega as disciplinas. Rejeita com `ErroCarregamento` (siglas falhas) só no fim; as demais ficam carregadas. */
  carregar(modelos: { sigla: string; dados: Uint8Array }[], progresso: (fracao: number) => void): Promise<void>
  descarregar(sigla: string): void
  arvore(): Promise<NoArvore[]>
  categorias(): Promise<CategoriaTotal[]>
  propriedades(ref: RefElemento): Promise<GrupoPropriedades[]>
  buscar(filtro: FiltroAtributo): Promise<RefElemento[]>
  /** Confere se os GlobalIds existem nos modelos carregados, na ordem das refs; `null` = disciplina não carregada. */
  existem(refs: RefElemento[]): Promise<(boolean | null)[]>
  selecionar(refs: RefElemento[]): void
  ocultar(refs: RefElemento[]): void
  /** Volta a mostrar os elementos (contrário de `ocultar`). */
  mostrar(refs: RefElemento[]): void
  isolar(refs: RefElemento[]): void
  mostrarTudo(): void
  /** Deixa translúcidos (~0,1) os itens fora da seleção atual; acompanha a seleção enquanto ligado. */
  fantasma(ligado: boolean): void
  colorirPor(modo: ModoCor): void
  enquadrar(refs?: RefElemento[]): void
  projecao(p: Projecao): void
  vistaPlanta(pavimento: string): void
  vistaElevacao(lado: 'N' | 'S' | 'L' | 'O'): void
  vista3d(): void
  caminhar(ligado: boolean): void
  /** Liga ou desliga o minimapa (canvas no canto com a posição da câmera). Opcional. */
  minimapa?(ligado: boolean): void
  /** `cortes.criar` é assíncrono por dentro: o evento `cortes` (entrega `Corte[]`) avisa quando a lista muda. */
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
