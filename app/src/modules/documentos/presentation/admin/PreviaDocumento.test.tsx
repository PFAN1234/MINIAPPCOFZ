import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RepositorioAdmin } from '../../../../admin/dados/repositorio.ts'
import { RepositorioAdminProvider } from '../../../../admin/dados/contexto.tsx'
import type { PdfPrevia } from '../../application/ports/PreviaPdf.port.ts'
import type { Documento } from '../../domain/documentos.ts'
import PreviaDocumento from './PreviaDocumento.tsx'
import { PreviaPdfProvider } from './previaPdf.tsx'

const doc: Documento = {
  id: 'd1',
  serie: 's1',
  codigo: 'X-001',
  titulo: 'Planta baixa',
  tipo: 'prancha',
  disciplina: 'ARQ',
  revisao: 'R01',
  caminho: 'o/s1/h.pdf',
  arquivoNome: 'planta.pdf',
  mime: 'application/pdf',
  bytes: 10,
  sha256: 'h',
  enviadoEm: '2026-11-10T12:00:00Z',
  enviadoPorNome: null,
  revisoes: 1,
  vinculos: [],
}

function falso(paginas = 3) {
  return {
    paginas,
    tamanho: vi.fn(async () => ({ largura: 600, altura: 800 })),
    desenhar: vi.fn(async () => {}),
    fechar: vi.fn(),
  } satisfies PdfPrevia
}

function renderizar(d: Documento, p: PdfPrevia, aoFechar = vi.fn()) {
  const repo = { baixarDocumento: async () => new Blob(['%PDF']) } as unknown as RepositorioAdmin
  const r = render(
    <RepositorioAdminProvider repositorio={repo}>
      <PreviaPdfProvider previa={{ abrirPdf: async () => p }}>
        <PreviaDocumento doc={d} aoFechar={aoFechar} />
      </PreviaPdfProvider>
    </RepositorioAdminProvider>,
  )
  return { aoFechar, ...r }
}

describe('PreviaDocumento', () => {
  it('abre ajustado à largura, pagina e dá zoom', async () => {
    const user = userEvent.setup()
    const p = falso()
    renderizar(doc, p)
    expect(screen.getByRole('dialog', { name: 'Planta baixa' })).toBeInTheDocument()
    expect(await screen.findByText('1 / 3')).toBeInTheDocument()
    await waitFor(() => expect(p.desenhar).toHaveBeenCalledWith(1, 1, expect.any(HTMLCanvasElement)))
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Próxima página' }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    await user.keyboard('{PageDown}')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled()
    await user.keyboard('{PageUp}')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Aumentar zoom' }))
    await waitFor(() => expect(p.desenhar).toHaveBeenLastCalledWith(2, 1.25, expect.any(HTMLCanvasElement)))
    expect(screen.getByText('125%')).toBeInTheDocument()
    await user.keyboard('-')
    await user.keyboard('-')
    expect(screen.getByText('75%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ajustar à largura' }))
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument())
  })

  it('Esc e Fechar fecham; fechar() do PDF roda ao desmontar', async () => {
    const user = userEvent.setup()
    const p = falso()
    const { aoFechar, unmount } = renderizar(doc, p)
    await screen.findByText('1 / 3')
    await user.keyboard('{Escape}')
    expect(aoFechar).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(aoFechar).toHaveBeenCalledTimes(2)
    expect(p.fechar).not.toHaveBeenCalled()
    unmount()
    expect(p.fechar).toHaveBeenCalledTimes(1)
  })

  it('formato sem prévia mostra os metadados e o Baixar', () => {
    renderizar({ ...doc, mime: 'application/octet-stream', arquivoNome: 'x.dwg' }, falso())
    expect(screen.getByText('x.dwg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Próxima página' })).not.toBeInTheDocument()
  })
})
