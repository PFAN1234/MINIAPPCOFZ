import { describe, expect, it } from 'vitest'
import ambientesJson from '../../../data/hto/ambientes.json'
import plantasJson from '../../../data/hto/plantas.json'
import type { Marcador, RecortePt } from '../dados/tipos.ts'
import { filtrarAmbientes } from './busca.ts'
import { marcadorParaPixel } from './coordenadas.ts'
import { ordenarNatural } from './ordenacao.ts'

interface PavJson {
  id: string
  pagina_pt: [number, number]
  recorte_pt: RecortePt
  imagens: { planta: { largura: number; altura: number } }
  detalhes: Record<string, { recorte_pt: RecortePt; largura: number; altura: number }>
}
const pavs = plantasJson.pavimentos as unknown as PavJson[]

describe('ordenação natural', () => {
  it('ordena números como números', () => {
    const nomes = ['Apto. 110', 'Apto. 102', 'Apto. 101', 'Apto. 20']
    expect(ordenarNatural(nomes, (n) => n)).toEqual([
      'Apto. 20',
      'Apto. 101',
      'Apto. 102',
      'Apto. 110',
    ])
  })

  it('ignora acento e caixa', () => {
    expect(ordenarNatural(['Zeladoria', 'Árvore', 'banheiro'], (n) => n)).toEqual([
      'Árvore',
      'banheiro',
      'Zeladoria',
    ])
  })
})

describe('busca sem acento', () => {
  const ambs = ambientesJson.ambientes
  it.each(['circ', 'circulacao', 'CIRCULAÇÃO SUL'])('"%s" acha Circulação sul', (q) => {
    expect(filtrarAmbientes(ambs, q).map((a) => a.nome_operacional)).toContain('Circulação sul')
  })

  it('busca também pelo nome na planta', () => {
    expect(filtrarAmbientes(ambs, 'admin.').map((a) => a.id)).toContain('terreo-administracao')
  })

  it('busca vazia devolve tudo e sem acerto devolve nada', () => {
    expect(filtrarAmbientes(ambs, '  ')).toHaveLength(ambs.length)
    expect(filtrarAmbientes(ambs, 'xyzxyz')).toHaveLength(0)
  })
})

describe('marcadorParaPixel com os dados reais', () => {
  it('o marcador do Apto. 101 cai dentro do recorte de detalhe dele', () => {
    const pav = pavs.find((p) => p.id === 'terreo')!
    const amb = ambientesJson.ambientes.find((a) => a.id === 'terreo-apto-101')!
    const det = pav.detalhes['terreo-apto-101']
    const m = amb.marcadores[0] as Marcador
    const p = marcadorParaPixel(m, {
      pagina_pt: pav.pagina_pt,
      recorte_pt: det.recorte_pt,
      largura: det.largura,
      altura: det.altura,
    })
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeLessThanOrEqual(det.largura)
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeLessThanOrEqual(det.altura)
  })

  it('todos os marcadores caem dentro da imagem do pavimento', () => {
    for (const amb of ambientesJson.ambientes) {
      const pav = pavs.find((p) => p.id === amb.pavimento)!
      for (const m of amb.marcadores) {
        const p = marcadorParaPixel(m, {
          pagina_pt: pav.pagina_pt,
          recorte_pt: pav.recorte_pt,
          largura: pav.imagens.planta.largura,
          altura: pav.imagens.planta.altura,
        })
        const msg = `${amb.id} (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`
        expect(p.x, msg).toBeGreaterThanOrEqual(0)
        expect(p.x, msg).toBeLessThanOrEqual(pav.imagens.planta.largura)
        expect(p.y, msg).toBeGreaterThanOrEqual(0)
        expect(p.y, msg).toBeLessThanOrEqual(pav.imagens.planta.altura)
      }
    }
  })

  it('aplica a fórmula do contrato', () => {
    const p = marcadorParaPixel(
      { x: 0.5, y: 0.5 },
      { pagina_pt: [200, 100], recorte_pt: [50, 10, 150, 90], largura: 1000, altura: 400 },
    )
    expect(p).toEqual({ x: 500, y: 200 })
  })
})
