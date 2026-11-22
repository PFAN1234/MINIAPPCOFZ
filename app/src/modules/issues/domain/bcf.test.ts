import { describe, expect, it } from 'vitest'
import type { Vista } from '../../modelos/domain/central.ts'
import {
  direcaoCenaParaIfc,
  direcaoIfcParaCena,
  globalIdsDoTopico,
  issueParaTopicoBcf,
  juntarExtras,
  pontoCenaParaIfc,
  pontoIfcParaCena,
  prazoDeBcf,
  prioridadeDeBcf,
  separarExtras,
  statusDeBcf,
  tipoDeBcf,
  topicoBcfParaTopico,
  vistaParaViewpoint,
  normalizarCorBcf,
  viewpointParaVista,
  type BcfTopico,
} from './bcf.ts'
import type { Issue } from './issues.ts'

const VISTA: Vista = {
  camera: { posicao: [10, 4, -6], alvo: [10, 4, -16], projecao: 'perspectiva', campo: 55 },
  cortes: [{ origem: [0, 3, 0], normal: [0, -1, 0] }],
  selecionados: [{ sigla: 'ARQ', globalId: 'G1' }],
  ocultos: [
    { sigla: 'ARQ', globalId: 'G2' },
    { sigla: 'ARQ', globalId: 'G3' },
  ],
  isolados: null,
}

function issue(extra: Partial<Issue> = {}): Issue {
  return {
    id: 'i1',
    numero: 7,
    guid: '11111111-aaaa-4aaa-8aaa-000000000001',
    titulo: 'Viga colidindo',
    descricao: 'Texto livre',
    tipo: 'conflito',
    prioridade: 'alta',
    status: 'em_andamento',
    responsavelId: 'r1',
    responsavelNome: 'Eduardo Lima',
    prazo: '2026-12-05',
    criadoPor: 'u1',
    criadoPorNome: 'Patrício Ferreira',
    criadoEm: '2026-11-12T13:00:00.000Z',
    atualizadoEm: '2026-11-13T09:30:00.000Z',
    vistas: [{ id: 'v1', guid: 'aaaaaaaa-1111-4111-8111-00000000000a', vista: VISTA, imagemPath: null, criadoEm: '2026-11-12T13:00:00.000Z' }],
    comentarios: [
      {
        id: 'c1',
        guid: 'cccccccc-1111-4111-8111-00000000000c',
        autorId: null,
        autorNome: 'Eduardo Lima',
        texto: 'Aviso feito.',
        vistaId: 'v1',
        criadoEm: '2026-11-13T09:30:00.000Z',
      },
    ],
    ...extra,
  }
}

const achaTudoEmARQ = (g: string) => (g.startsWith('G') ? 'ARQ' : null)

describe('eixos', () => {
  it('cena Y-up → IFC Z-up: (x, y, z) → (x, -z, y), e de volta', () => {
    expect(pontoCenaParaIfc([1, 2, 3])).toEqual([1, -3, 2])
    expect(pontoIfcParaCena([1, -3, 2])).toEqual([1, 2, 3])
    expect(direcaoCenaParaIfc([0, 1, 0])).toEqual([0, 0, 1])
    expect(direcaoIfcParaCena([0, 0, 1])).toEqual([0, 1, 0])
  })

  it('aplica o deslocamento de coordenação na ida e tira na volta', () => {
    const o: [number, number, number] = [200, -1, -300]
    const ifc = pontoCenaParaIfc([1, 2, 3], o)
    expect(ifc).toEqual([201, 297, 1])
    expect(pontoIfcParaCena(ifc, o)).toEqual([1, 2, 3])
  })

  it('a câmera da cena sai em Z-up com "cima" = +Z', () => {
    const vp = vistaParaViewpoint(VISTA, 'g')
    expect(vp.camera?.posicao).toEqual([10, 6, 4])
    // olha para -Z da cena = +Y do IFC; o comprimento é a distância até o alvo (10 m)
    expect(vp.camera?.direcao).toEqual([0, 10, 0])
    expect(vp.camera?.cima).toEqual([0, 0, 1])
    expect(vp.planos).toEqual([{ origem: [0, 0, 3], direcao: [0, 0, -1] }])
  })

  it('olhando na vertical, o "cima" cai para +Y', () => {
    const vp = vistaParaViewpoint({ ...VISTA, camera: { posicao: [0, 20, 0], alvo: [0, 0, 0], projecao: 'ortografica', campo: 30 } }, 'g')
    expect(vp.camera?.direcao).toEqual([0, 0, -20])
    expect(vp.camera?.cima).toEqual([0, 1, 0])
    expect(vp.camera?.campo).toBe(30)
  })
})

describe('vista ↔ viewpoint', () => {
  it('direção unitária (outras ferramentas): alvo a 10 m na mesma direção', () => {
    const vp = vistaParaViewpoint(VISTA, 'g')
    const d = vp.camera!.direcao
    const n = Math.hypot(...d)
    const unit = { ...vp, camera: { ...vp.camera!, direcao: [d[0] / n, d[1] / n, d[2] / n] as [number, number, number] } }
    const v = viewpointParaVista(unit, achaTudoEmARQ)!.vista
    expect(Math.hypot(...v.camera.alvo.map((x, i) => x - v.camera.posicao[i]))).toBeCloseTo(10, 9)
  })

  it('ida e volta preserva posição, direção, campo, cortes, seleção e ocultos', () => {
    const vp = vistaParaViewpoint(VISTA, 'g')
    const volta = viewpointParaVista(vp, achaTudoEmARQ)!
    expect(volta.descartados).toBe(0)
    const v = volta.vista
    expect(v.camera.posicao).toEqual(VISTA.camera.posicao)
    expect(v.camera.projecao).toBe('perspectiva')
    expect(v.camera.campo).toBe(55)
    // Alvo: o comprimento da direção exportada guarda a distância, então volta o mesmo ponto.
    v.camera.alvo.forEach((x, i) => expect(x).toBeCloseTo(VISTA.camera.alvo[i], 9))
    expect(v.cortes).toEqual(VISTA.cortes)
    expect(v.selecionados).toEqual(VISTA.selecionados)
    expect(v.ocultos).toEqual(VISTA.ocultos)
    expect(v.isolados).toBeNull()
  })

  it('cores explícitas: ida e volta e normalização da cor importada', () => {
    const comCores = { ...VISTA, cores: [{ refs: [{ sigla: 'ARQ', globalId: 'G7' }], cor: '#ff8000' }] }
    const vp = vistaParaViewpoint(comCores, 'g')
    expect(vp.cores).toEqual([{ cor: 'FFFF8000', ids: ['G7'] }])
    expect(viewpointParaVista(vp, achaTudoEmARQ)!.vista.cores).toEqual(comCores.cores)
    expect(normalizarCorBcf('80AbCdEf')).toBe('#abcdef')
    expect(normalizarCorBcf('#00FF00')).toBe('#00ff00')
    expect(normalizarCorBcf('xyz')).toBeNull()
    // modoCor não vai para o BCF.
    expect(vistaParaViewpoint({ ...VISTA, modoCor: 'categoria' }, 'g').cores).toBeUndefined()
  })

  it('isolados viram DefaultVisibility=false com exceções, e voltam como isolados', () => {
    const iso = { ...VISTA, ocultos: [], isolados: [{ sigla: 'ARQ', globalId: 'G9' }] }
    const vp = vistaParaViewpoint(iso, 'g')
    expect(vp.visibilidadePadrao).toBe(false)
    expect(vp.excecoes).toEqual(['G9'])
    const v = viewpointParaVista(vp, achaTudoEmARQ)!.vista
    expect(v.isolados).toEqual([{ sigla: 'ARQ', globalId: 'G9' }])
    expect(v.ocultos).toEqual([])
  })

  it('descarta GlobalIds sem disciplina e conta', () => {
    const vp = vistaParaViewpoint({ ...VISTA, selecionados: [{ sigla: 'ARQ', globalId: 'G1' }, { sigla: 'ARQ', globalId: 'X1' }] }, 'g')
    const r = viewpointParaVista(vp, achaTudoEmARQ)!
    expect(r.vista.selecionados).toEqual([{ sigla: 'ARQ', globalId: 'G1' }])
    expect(r.descartados).toBe(1)
  })

  it('sem câmera não há vista', () => {
    expect(viewpointParaVista({ ...vistaParaViewpoint(VISTA, 'g'), camera: null }, achaTudoEmARQ)).toBeNull()
  })

  it('deslocamento de coordenação volta exato', () => {
    const o: [number, number, number] = [201.82966, -1.19, -327.13588]
    const vp = vistaParaViewpoint(VISTA, 'g', o)
    const v = viewpointParaVista(vp, achaTudoEmARQ, o)!.vista
    v.camera.posicao.forEach((n, i) => expect(n).toBeCloseTo(VISTA.camera.posicao[i], 9))
    v.cortes[0].origem.forEach((n, i) => expect(n).toBeCloseTo(VISTA.cortes[0].origem[i], 9))
  })
})

describe('enumerações', () => {
  it('status conhecidos e desconhecidos', () => {
    expect(statusDeBcf('Open')).toBe('aberta')
    expect(statusDeBcf('In Progress')).toBe('em_andamento')
    expect(statusDeBcf('in_progress')).toBe('em_andamento')
    expect(statusDeBcf('Resolved')).toBe('resolvida')
    expect(statusDeBcf('Closed')).toBe('fechada')
    expect(statusDeBcf('Active')).toBe('aberta')
    expect(statusDeBcf('Estranho')).toBe('aberta')
    expect(statusDeBcf(null)).toBe('aberta')
  })

  it('prioridade e tipo conhecidos e desconhecidos', () => {
    expect(prioridadeDeBcf('Critical')).toBe('critica')
    expect(prioridadeDeBcf('Major')).toBe('alta')
    expect(prioridadeDeBcf('Low')).toBe('baixa')
    expect(prioridadeDeBcf('???')).toBe('normal')
    expect(tipoDeBcf('Clash')).toBe('conflito')
    expect(tipoDeBcf('Request')).toBe('duvida')
    expect(tipoDeBcf('Todo')).toBe('pendencia')
    expect(tipoDeBcf('Fault')).toBe('problema')
    expect(tipoDeBcf('Coisa')).toBe('problema')
  })

  it('prazo usa a data como escrita; inválido vira null', () => {
    expect(prazoDeBcf('2026-12-05T00:00:00-03:00')).toBe('2026-12-05')
    expect(prazoDeBcf('2026-02-30')).toBeNull()
    expect(prazoDeBcf('amanhã')).toBeNull()
    expect(prazoDeBcf(null)).toBeNull()
  })
})

describe('extras com prefixo [BCF]', () => {
  it('separa e junta sem duplicar', () => {
    const d = juntarExtras('Texto', { Responsável: 'a@b.c', Etiquetas: 'x, y' })
    expect(d).toBe('Texto\n\n[BCF] Responsável: a@b.c\n[BCF] Etiquetas: x, y')
    const { texto, extras } = separarExtras(d)
    expect(texto).toBe('Texto')
    expect(extras).toEqual({ Responsável: 'a@b.c', Etiquetas: 'x, y' })
    expect(juntarExtras(texto, extras)).toBe(d)
  })

  it('sem texto nem extras, a descrição é null', () => {
    expect(juntarExtras('', {})).toBeNull()
    expect(juntarExtras('', { Etapa: 'Obra' })).toBe('[BCF] Etapa: Obra')
  })
})

const TOPICO: BcfTopico = {
  guid: '11111111-aaaa-4aaa-8aaa-000000000001',
  tipo: 'Clash',
  status: 'Active',
  prioridade: 'Major',
  titulo: 'Viga',
  descricao: 'Rever.',
  criadoEm: '2026-11-10T09:15:30-03:00',
  autor: 'maria@projetos.test',
  modificadoEm: null,
  modificadoPor: null,
  prazo: '2026-12-05T00:00:00-03:00',
  responsavel: 'joao@projetos.test',
  etiquetas: ['Estrutura', 'Hidráulica'],
  etapa: 'Executivo',
  viewpoints: [{ ...vistaParaViewpoint(VISTA, 'aaaaaaaa-1111-4111-8111-00000000000a'), selecionados: ['G1', 'X9'] }],
  comentarios: [
    { guid: 'c1', data: '2026-11-11T08:00:00Z', autor: 'joao@projetos.test', texto: 'Vou avisar.', viewpointGuid: 'aaaaaaaa-1111-4111-8111-00000000000a' },
    { guid: 'c2', data: null, autor: null, texto: '  ', viewpointGuid: null },
    { guid: 'c3', data: null, autor: 'x', texto: 'Outro', viewpointGuid: 'inexistente' },
  ],
}

describe('tópico BCF → importação', () => {
  const r = topicoBcfParaTopico(TOPICO, { siglaDe: achaTudoEmARQ })

  it('mapeia campos e põe o que não tem equivalente na descrição com prefixo', () => {
    expect(r.topico).toMatchObject({
      guid: TOPICO.guid,
      titulo: 'Viga',
      tipo: 'conflito',
      status: 'aberta',
      prioridade: 'alta',
      prazo: '2026-12-05',
    })
    expect(r.topico.descricao).toBe(
      'Rever.\n\n[BCF] Responsável: joao@projetos.test\n[BCF] Etiquetas: Estrutura, Hidráulica\n[BCF] Etapa: Executivo\n[BCF] Autor: maria@projetos.test',
    )
    expect(r.topico.criadoEm).toBe('2026-11-10T12:15:30.000Z')
  })

  it('conta elementos não encontrados, liga comentário à vista e pula comentário vazio', () => {
    expect(r.descartados).toBe(1)
    expect(r.topico.vistas).toHaveLength(1)
    expect(r.topico.comentarios).toEqual([
      { guid: 'c1', texto: '[BCF] Autor: joao@projetos.test\nVou avisar.', criadoEm: '2026-11-11T08:00:00.000Z', vistaGuid: 'aaaaaaaa-1111-4111-8111-00000000000a' },
      { guid: 'c3', texto: '[BCF] Autor: x\nOutro', criadoEm: null, vistaGuid: null },
    ])
    expect(globalIdsDoTopico(TOPICO).sort()).toEqual(['G1', 'G2', 'G3', 'X9'])
  })

  it('reimportar uma descrição que já tem o prefixo não duplica', () => {
    const de = topicoBcfParaTopico({ ...TOPICO, descricao: r.topico.descricao ?? null }, { siglaDe: achaTudoEmARQ })
    expect(de.topico.descricao).toBe(r.topico.descricao)
    const c = topicoBcfParaTopico(
      { ...TOPICO, comentarios: [{ ...TOPICO.comentarios[0], texto: r.topico.comentarios![0].texto }] },
      { siglaDe: achaTudoEmARQ },
    )
    expect(c.topico.comentarios![0].texto).toBe('[BCF] Autor: joao@projetos.test\nVou avisar.')
  })

  it('título vazio ou longo é ajustado; valores desconhecidos usam os padrões', () => {
    const t = topicoBcfParaTopico({ ...TOPICO, titulo: '  ', status: 'x', prioridade: null, tipo: null }, { siglaDe: achaTudoEmARQ }).topico
    expect(t).toMatchObject({ titulo: 'Sem título', status: 'aberta', prioridade: 'normal', tipo: 'problema' })
    expect(topicoBcfParaTopico({ ...TOPICO, titulo: 'a'.repeat(300) }, { siglaDe: achaTudoEmARQ }).topico.titulo).toHaveLength(200)
  })
})

describe('issue → tópico BCF', () => {
  it('mapeia status, prioridade, tipo, prazo, responsável, comentário e viewpoint', () => {
    const t = issueParaTopicoBcf(issue())
    expect(t).toMatchObject({
      guid: '11111111-aaaa-4aaa-8aaa-000000000001',
      tipo: 'Clash',
      status: 'In Progress',
      prioridade: 'High',
      titulo: 'Viga colidindo',
      descricao: 'Texto livre',
      prazo: '2026-12-05',
      responsavel: 'Eduardo Lima',
      autor: 'Patrício Ferreira',
    })
    expect(t.viewpoints).toHaveLength(1)
    expect(t.comentarios[0]).toMatchObject({ autor: 'Eduardo Lima', texto: 'Aviso feito.', viewpointGuid: 'aaaaaaaa-1111-4111-8111-00000000000a' })
  })

  it('linhas [BCF] da descrição voltam aos campos próprios e saem do texto', () => {
    const t = issueParaTopicoBcf(
      issue({
        responsavelNome: null,
        descricao: 'Texto\n\n[BCF] Responsável: a@b.c\n[BCF] Etiquetas: x, y\n[BCF] Etapa: Obra\n[BCF] Autor: z@w.t',
        criadoPorNome: null,
        comentarios: [{ id: 'c', guid: 'g', autorId: null, autorNome: null, texto: '[BCF] Autor: k@l.m\nOi', vistaId: null, criadoEm: '2026-11-13T09:30:00.000Z' }],
      }),
    )
    expect(t).toMatchObject({ descricao: 'Texto', responsavel: 'a@b.c', etiquetas: ['x', 'y'], etapa: 'Obra', autor: 'z@w.t' })
    expect(t.comentarios[0]).toMatchObject({ autor: 'k@l.m', texto: 'Oi' })
  })

  it('ida e volta Issue → BCF → importação preserva o que deve', () => {
    const origem = issue()
    const { topico } = topicoBcfParaTopico(issueParaTopicoBcf(origem), { siglaDe: achaTudoEmARQ })
    expect(topico).toMatchObject({
      guid: origem.guid,
      titulo: origem.titulo,
      tipo: 'conflito',
      prioridade: 'alta',
      status: 'em_andamento',
      prazo: '2026-12-05',
      criadoEm: origem.criadoEm,
    })
    expect(topico.vistas![0].guid).toBe(origem.vistas[0].guid)
    expect(topico.vistas![0].vista.camera.posicao).toEqual(VISTA.camera.posicao)
    expect(topico.vistas![0].vista.selecionados).toEqual(VISTA.selecionados)
    expect(topico.comentarios![0]).toMatchObject({ guid: origem.comentarios[0].guid, vistaGuid: origem.vistas[0].guid })
    // O responsável vira linha de texto legível; o resto fica como estava.
    expect(topico.descricao).toBe('Texto livre\n\n[BCF] Responsável: Eduardo Lima\n[BCF] Autor: Patrício Ferreira')
    // Segunda volta: exportar a issue importada e reimportar não muda a descrição.
    const issue2 = issue({ descricao: topico.descricao, responsavelNome: null, criadoPorNome: null })
    const volta2 = topicoBcfParaTopico(issueParaTopicoBcf(issue2), { siglaDe: achaTudoEmARQ }).topico
    expect(volta2.descricao).toBe(topico.descricao)
  })
})
