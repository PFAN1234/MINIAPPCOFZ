import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepositorioAdminProvider } from '../../../../../../admin/dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../../../../../admin/dados/fixture.ts'
import type { Conversor } from '../../../../application/ports/ConversorIfcPort.port.ts'
import { ConversorProvider } from '../../../../infra/conversor.ts'
import { OBRAS } from '../obrasDeTeste.ts'
import Gestao from './Gestao.tsx'

const FRAG = new Uint8Array([0x78, 0x9c, 1, 2, 3, 4])

/** Conversor falso: anuncia uma etapa e devolve um .frag mínimo (ou falha). */
function conversorFalso(erro?: string): Conversor & { chamadas: number } {
  const c = {
    chamadas: 0,
    async converter(_arquivo: Blob, aoProgredir: (p: { fracao: number; texto: string }) => void) {
      c.chamadas++
      aoProgredir({ fracao: 0.5, texto: 'Lendo as geometrias' })
      if (erro) throw new Error(erro)
      return FRAG
    },
  }
  return c
}

async function renderizar(conversor: Conversor, repo = criarRepositorioAdminFixture()) {
  // O id da obra tem de ser o da fixture: o Storage falso confere a pasta.
  const obra = { ...OBRAS[0], obra_id: (await repo.obterObra('hto')).obra.id }
  const aoMudar = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <ConversorProvider conversor={conversor}>
          <Gestao obra={obra} aoMudar={aoMudar} />
        </ConversorProvider>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return { repo, aoMudar }
}

const arquivo = (nome: string, bytes: BlobPart = 'ISO-10303-21;') => new File([bytes], nome)

describe('Gestão (fixture)', () => {
  it('IFC: converte, publica, mostra na lista e no histórico; .frag inválido é recusado', async () => {
    const user = userEvent.setup()
    const conversor = conversorFalso()
    const { repo, aoMudar } = await renderizar(conversor)
    expect(await screen.findByText(/Nenhum modelo publicado/)).toBeInTheDocument()

    await user.upload(screen.getByLabelText(/Arquivo do modelo/), arquivo('CE01-14PE01-HID-R03.ifc'))
    expect(screen.getByLabelText('Sigla da disciplina')).toHaveValue('HID')
    expect(screen.getByLabelText('Revisão', { exact: true })).toHaveValue('R03')
    await user.click(screen.getByRole('button', { name: 'Converter' }))
    expect(await screen.findByText(/Convertido: \.frag com/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publicar HID' }))
    expect(await screen.findByText(/Publicado: HID, revisão R03/)).toBeInTheDocument()
    expect(screen.getByText(/a cena desta página já foi atualizada/)).toBeInTheDocument()
    expect(aoMudar).toHaveBeenCalledWith('HID')
    expect(await screen.findByTestId('modelo-HID')).toHaveTextContent('R03')
    const historico = screen.getByRole('region', { name: 'Histórico' })
    expect(within(historico).getByText(/convertido no site/)).toBeInTheDocument()
    expect(within(historico).getAllByRole('listitem')).toHaveLength(1)
    expect((await repo.listarModelosAdmin('hto')).modelos[0]).toMatchObject({ sigla: 'HID', bytes: FRAG.length })

    // Mesma sigla: aviso de substituição. Um .frag que não é .frag é recusado na hora de publicar.
    await user.upload(screen.getByLabelText(/Arquivo do modelo/), arquivo('HID.frag', 'nada'))
    await user.type(screen.getByLabelText('Sigla da disciplina'), 'HID')
    expect(screen.getByText(/Já há HID publicado/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publicar HID' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/não parece um \.frag/)
    expect(conversor.chamadas).toBe(1)
    expect(aoMudar).toHaveBeenCalledTimes(1)
  })

  it('sigla inválida bloqueia; erro da conversão aparece; arquivo de outro tipo é recusado', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await renderizar(conversorFalso('A conversão ficou sem memória neste navegador'))
    await user.upload(await screen.findByLabelText(/Arquivo do modelo/), arquivo('planta.pdf'))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha um arquivo .ifc ou .frag.')

    await user.upload(screen.getByLabelText(/Arquivo do modelo/), arquivo('modelo.ifc'))
    expect(screen.getByRole('alert')).toHaveTextContent(/2 a 4 letras/)
    expect(screen.getByRole('button', { name: 'Converter' })).toBeDisabled()
    await user.type(screen.getByLabelText('Sigla da disciplina'), 'ele')
    expect(screen.getByLabelText('Sigla da disciplina')).toHaveValue('ELE')
    await user.click(screen.getByRole('button', { name: 'Converter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/sem memória/)
  })

  it('retirar pede confirmação e avisa a central', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const obra = (await repo.obterObra('hto')).obra
    await repo.enviarArquivo('modelos', `${obra.id}/ARQ/0123456789abcdef.frag`, new Blob([FRAG]), 'application/octet-stream')
    await repo.registrarModelo('hto', {
      sigla: 'ARQ',
      revisao: 'R06',
      caminho: `${obra.id}/ARQ/0123456789abcdef.frag`,
      bytes: FRAG.length,
      hash: '0123456789abcdef',
      origem: 'frag',
    })
    const { aoMudar } = await renderizar(conversorFalso(), repo)
    await user.click(await screen.findByRole('button', { name: 'Retirar ARQ' }))
    expect(aoMudar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirmar: retirar ARQ' }))
    expect(await screen.findByText(/Nenhum modelo publicado/)).toBeInTheDocument()
    await waitFor(() => expect(aoMudar).toHaveBeenCalledWith('ARQ'))
    const item = within(screen.getByRole('region', { name: 'Histórico' })).getAllByRole('listitem')[0]
    expect(item).toHaveTextContent('Retirado ARQ')
  })
})
