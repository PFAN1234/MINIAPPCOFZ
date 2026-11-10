import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { marcadorParaPixel } from '../util/coordenadas.ts'
import { PlantaViewer } from './PlantaViewer.tsx'

const repo = criarRepositorioFixture()

async function cenario() {
  const obra = await repo.obterObra('hto')
  const planta = obra.pavimentos[0].planta!
  const marcadores = obra.ambientes
    .filter((a) => a.pavimento_codigo === 'terreo')
    .flatMap((a) =>
      a.marcadores.map((m) => ({ codigo: a.codigo, nome: a.nome_operacional, ...m, pendencias: a.pendencias_abertas })),
    )
  const imagem = {
    url: '/x.webp',
    largura: planta.imagem.largura,
    altura: planta.imagem.altura,
    recorte_pt: planta.recorte_pt,
    pagina_pt: planta.pagina_pt,
  }
  return { obra, planta, marcadores, imagem }
}

describe('PlantaViewer', () => {
  it('desenha o pino do Apto. 101 na posição de marcadorParaPixel e trata o toque', async () => {
    const { obra, imagem, marcadores } = await cenario()
    const onSelecionar = vi.fn()
    render(<PlantaViewer imagem={imagem} marcadores={marcadores} onSelecionar={onSelecionar} />)
    const pino = screen.getByRole('button', { name: 'Apto. 101' })
    const apto = obra.ambientes.find((a) => a.codigo === 'terreo-apto-101')!
    const esperado = marcadorParaPixel(apto.marcadores[0], imagem)
    expect(Number(pino.getAttribute('data-x'))).toBeCloseTo(esperado.x, 5)
    expect(Number(pino.getAttribute('data-y'))).toBeCloseTo(esperado.y, 5)
    expect(esperado.x).toBeGreaterThan(0)
    expect(esperado.x).toBeLessThan(imagem.largura)
    fireEvent.click(pino)
    expect(onSelecionar).toHaveBeenCalledWith('terreo-apto-101')
  })

  it('arraste não vira toque', async () => {
    const { imagem, marcadores } = await cenario()
    const onSelecionar = vi.fn()
    render(<PlantaViewer imagem={imagem} marcadores={marcadores} onSelecionar={onSelecionar} />)
    const pino = screen.getByRole('button', { name: 'Apto. 101' })
    fireEvent.pointerDown(pino, { clientX: 10, clientY: 10 })
    fireEvent.click(pino, { clientX: 80, clientY: 10 })
    expect(onSelecionar).not.toHaveBeenCalled()
  })

  it('ambiente com 2 marcadores gera 2 pinos', async () => {
    const { obra, imagem, marcadores } = await cenario()
    const duplo = obra.ambientes.find((a) => a.pavimento_codigo === 'terreo' && a.marcadores.length === 2)
    expect(duplo).toBeDefined()
    render(<PlantaViewer imagem={imagem} marcadores={marcadores} onSelecionar={() => {}} />)
    expect(screen.getAllByRole('button', { name: duplo!.nome_operacional })).toHaveLength(2)
    expect(screen.getAllByRole('button')).toHaveLength(marcadores.length)
  })

  it('selo de pendências só aparece quando > 0', async () => {
    const { imagem } = await cenario()
    const base = { x: 0.2, y: 0.2 }
    const { rerender } = render(
      <PlantaViewer imagem={imagem} marcadores={[{ codigo: 'a', nome: 'A', ...base, pendencias: 0 }]} onSelecionar={() => {}} />,
    )
    expect(screen.queryByTestId('pino-selo')).toBeNull()
    rerender(
      <PlantaViewer imagem={imagem} marcadores={[{ codigo: 'a', nome: 'A', ...base, pendencias: 2 }]} onSelecionar={() => {}} />,
    )
    expect(screen.getByTestId('pino-selo')).toHaveTextContent('2')
  })
})
