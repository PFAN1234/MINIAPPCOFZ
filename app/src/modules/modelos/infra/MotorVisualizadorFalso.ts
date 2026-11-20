import type { EventoMotor, MotorVisualizador, TemaCentral } from '../application/ports/MotorVisualizador.port.ts'
import {
  ErroCarregamento,
  type CategoriaTotal,
  type NoArvore,
  type RefElemento,
  type Vista,
} from '../domain/central.ts'

export interface ChamadaMotor {
  metodo: string
  args: unknown[]
}

/** Dublê do motor para testes (jsdom): guarda as chamadas e devolve dados configuráveis. */
export class MotorVisualizadorFalso implements MotorVisualizador {
  chamadas: ChamadaMotor[] = []
  arvoreDados: NoArvore[] = []
  categoriasDados: CategoriaTotal[] = []
  /** Siglas que `carregar` recusa (rejeita com `ErroCarregamento` no fim). */
  siglasComFalha = new Set<string>()
  carregadas: string[] = []
  liberado = false
  private ouvintes = new Map<EventoMotor, Set<(d: unknown) => void>>()

  private registrar(metodo: string, ...args: unknown[]) {
    this.chamadas.push({ metodo, args })
  }
  chamadasDe(metodo: string): unknown[][] {
    return this.chamadas.filter((c) => c.metodo === metodo).map((c) => c.args)
  }
  /** Dispara um evento como o motor real faria. */
  emitir(evento: EventoMotor, dados: unknown) {
    for (const cb of this.ouvintes.get(evento) ?? []) cb(dados)
  }

  async montar(el: HTMLElement, tema: TemaCentral) {
    this.registrar('montar', el, tema)
  }
  tema(tema: TemaCentral) {
    this.registrar('tema', tema)
  }
  async carregar(modelos: { sigla: string; dados: Uint8Array }[], progresso: (f: number) => void) {
    this.registrar('carregar', modelos.map((m) => m.sigla))
    const falhas: string[] = []
    for (const [i, m] of modelos.entries()) {
      if (this.siglasComFalha.has(m.sigla)) falhas.push(m.sigla)
      else this.carregadas.push(m.sigla)
      progresso((i + 1) / modelos.length)
    }
    if (falhas.length) throw new ErroCarregamento(falhas)
  }
  descarregar(sigla: string) {
    this.registrar('descarregar', sigla)
    this.carregadas = this.carregadas.filter((s) => s !== sigla)
  }
  async arvore() {
    this.registrar('arvore')
    return this.arvoreDados
  }
  async categorias() {
    this.registrar('categorias')
    return this.categoriasDados
  }
  async propriedades() {
    this.registrar('propriedades')
    return []
  }
  async buscar() {
    this.registrar('buscar')
    return []
  }
  selecionar(refs: RefElemento[]) {
    this.registrar('selecionar', refs)
  }
  ocultar(refs: RefElemento[]) {
    this.registrar('ocultar', refs)
  }
  isolar(refs: RefElemento[]) {
    this.registrar('isolar', refs)
  }
  mostrarTudo() {
    this.registrar('mostrarTudo')
  }
  fantasma(ligado: boolean) {
    this.registrar('fantasma', ligado)
  }
  colorirPor(modo: 'nenhum' | 'categoria' | 'disciplina') {
    this.registrar('colorirPor', modo)
  }
  enquadrar(refs?: RefElemento[]) {
    this.registrar('enquadrar', refs)
  }
  projecao(p: 'perspectiva' | 'ortografica') {
    this.registrar('projecao', p)
  }
  vistaPlanta(pavimento: string) {
    this.registrar('vistaPlanta', pavimento)
  }
  vistaElevacao(lado: 'N' | 'S' | 'L' | 'O') {
    this.registrar('vistaElevacao', lado)
  }
  vista3d() {
    this.registrar('vista3d')
  }
  caminhar(ligado: boolean) {
    this.registrar('caminhar', ligado)
  }
  cortes = {
    criar: () => this.registrar('cortes.criar'),
    apagar: (id?: string) => this.registrar('cortes.apagar', id),
    listar: () => [],
  }
  medir = {
    modo: (m: 'distancia' | 'area' | 'volume' | 'angulo' | null) => this.registrar('medir.modo', m),
    listar: () => [],
    apagar: (id?: string) => this.registrar('medir.apagar', id),
  }
  vistaAtual(): Vista {
    return {
      camera: { posicao: [0, 0, 0], alvo: [0, 0, 0], projecao: 'perspectiva' },
      cortes: [],
      selecionados: [],
      ocultos: [],
      isolados: null,
    }
  }
  async aplicarVista(v: Vista) {
    this.registrar('aplicarVista', v)
  }
  async capturar() {
    return new Blob()
  }
  marcadores(itens: { id: string; posicao: [number, number, number]; rotulo: string }[]) {
    this.registrar('marcadores', itens)
  }
  ao(evento: EventoMotor, cb: (dados: unknown) => void) {
    const set = this.ouvintes.get(evento) ?? new Set()
    set.add(cb)
    this.ouvintes.set(evento, set)
    return () => {
      set.delete(cb)
    }
  }
  liberar() {
    this.registrar('liberar')
    this.liberado = true
    this.ouvintes.clear()
  }
}
