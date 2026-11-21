import type { EventoMotor, MotorVisualizador, TemaCentral } from '../application/ports/MotorVisualizador.port.ts'
import {
  ErroCarregamento,
  type CategoriaTotal,
  type Corte,
  type Medida,
  type FiltroAtributo,
  type GrupoPropriedades,
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
  /** Resultado de `propriedades`. */
  propriedadesDados: GrupoPropriedades[] = [
    {
      nome: 'Atributos',
      itens: [
        { nome: 'Classe', valor: 'IFCWALL' },
        { nome: 'GlobalId', valor: '3cUkl32yn9qRSPvBJVyWYp' },
        { nome: 'Name', valor: 'Parede 1' },
      ],
    },
    { nome: 'Pset_WallCommon', itens: [{ nome: 'IsExternal', valor: 'Sim' }] },
  ]
  propriedadesErro = false
  /** GlobalIds que `existem` responde como ausentes (`false`). */
  globalIdsAusentes = new Set<string>()
  /** Siglas que `existem` responde como não carregadas (`null`). */
  siglasNaoCarregadas = new Set<string>()
  /** Resultado de `buscar`. */
  buscaDados: RefElemento[] = []
  /** Siglas que `carregar` recusa (rejeita com `ErroCarregamento` no fim). */
  siglasComFalha = new Set<string>()
  carregadas: string[] = []
  liberado = false
  /** Última vista pedida (`3d` até alguém pedir outra). */
  vista: { tipo: '3d' } | { tipo: 'planta'; pavimento: string } | { tipo: 'elevacao'; lado: 'N' | 'S' | 'L' | 'O' } = {
    tipo: '3d',
  }
  caminhando = false
  /** Quantas vezes o minimapa foi ligado, e se está ligado agora. */
  minimapaLigacoes = 0
  minimapaLigado = false
  cortesLista: Corte[] = []
  medidasLista: Medida[] = []
  private contadorCortes = 0
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
  async propriedades(ref: RefElemento) {
    this.registrar('propriedades', ref)
    if (this.propriedadesErro) throw new Error('falha')
    return this.propriedadesDados
  }
  async buscar(filtro: FiltroAtributo) {
    this.registrar('buscar', filtro)
    return this.buscaDados
  }
  async existem(refs: RefElemento[]) {
    this.registrar('existem', refs)
    return refs.map((r) => (this.siglasNaoCarregadas.has(r.sigla) ? null : !this.globalIdsAusentes.has(r.globalId)))
  }
  grade(ligado: boolean) {
    this.registrar('grade', ligado)
  }
  hover(ligado: boolean) {
    this.registrar('hover', ligado)
  }
  selecionar(refs: RefElemento[]) {
    this.registrar('selecionar', refs)
  }
  ocultar(refs: RefElemento[]) {
    this.registrar('ocultar', refs)
  }
  mostrar(refs: RefElemento[]) {
    this.registrar('mostrar', refs)
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
    this.vista = { tipo: 'planta', pavimento }
  }
  vistaElevacao(lado: 'N' | 'S' | 'L' | 'O') {
    this.registrar('vistaElevacao', lado)
    this.vista = { tipo: 'elevacao', lado }
  }
  vista3d() {
    this.registrar('vista3d')
    this.vista = { tipo: '3d' }
  }
  caminhar(ligado: boolean) {
    this.registrar('caminhar', ligado)
    this.caminhando = ligado
  }
  minimapa(ligado: boolean) {
    this.registrar('minimapa', ligado)
    if (ligado && !this.minimapaLigado) this.minimapaLigacoes++
    this.minimapaLigado = ligado
  }
  cortes = {
    criar: () => {
      this.registrar('cortes.criar')
      this.cortesLista = [
        ...this.cortesLista,
        { id: `corte-${++this.contadorCortes}`, origem: [0, 0, 0], normal: [0, -1, 0] },
      ]
      this.emitir('cortes', this.cortesLista)
    },
    apagar: (id?: string) => {
      this.registrar('cortes.apagar', id)
      this.cortesLista = id ? this.cortesLista.filter((c) => c.id !== id) : []
      this.emitir('cortes', this.cortesLista)
    },
    listar: () => this.cortesLista,
  }
  medir = {
    modo: (m: 'distancia' | 'area' | 'volume' | 'angulo' | null) => this.registrar('medir.modo', m),
    listar: () => this.medidasLista,
    apagar: (id?: string) => {
      this.registrar('medir.apagar', id)
      this.medidasLista = id ? this.medidasLista.filter((x) => x.id !== id) : []
      this.emitir('medicao', this.medidasLista)
    },
  }
  /** Simula o usuário concluindo uma medição (os testes populam a lista por aqui). */
  adicionarMedida(m: Medida) {
    this.medidasLista = [...this.medidasLista, m]
    this.emitir('medicao', this.medidasLista)
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
