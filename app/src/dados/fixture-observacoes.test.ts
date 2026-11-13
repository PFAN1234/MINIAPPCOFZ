import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from './fixture.ts'

const HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const AURORA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02'
const DA_PATRICIO = '00000000-0000-4000-8000-000000000501'
const MINHA = '00000000-0000-4000-8000-000000000502'
const NOVA = '00000000-0000-4000-8000-000000000599'

afterEach(() => {
  vi.restoreAllMocks()
})

const nova = (extra = {}) => ({
  id: NOVA,
  obraId: HTO,
  texto: '  Chuva forte das 14h às 15h.  ',
  escritoEm: new Date().toISOString(),
  ...extra,
})

describe('fixture: observações do dia', () => {
  it('duas observações de hoje na HTO: uma de CP PATRICIO e outra do usuário de teste', async () => {
    const repo = criarRepositorioFixture()
    const dia = await repo.observacoesDoDia(HTO)
    expect(dia.fuso).toBe('America/Fortaleza')
    expect(dia.travada).toBe(false)
    expect(dia.observacoes.map((o) => [o.id, o.autor.nome, o.minha, o.data === dia.data])).toEqual([
      [DA_PATRICIO, 'CP PATRICIO', false, true],
      [MINHA, 'Você (teste)', true, true],
    ])
    expect((await repo.observacoesDoDia(AURORA)).observacoes).toEqual([])
    await expect(repo.observacoesDoDia('outra')).rejects.toMatchObject({ tipo: 'permissao' })
  })

  it('salvar cria com o texto aparado, é idempotente pelo id e persiste', async () => {
    const persistencia = localStorage
    const repo = criarRepositorioFixture({ persistencia })
    const salva = await repo.salvarObservacao(nova())
    expect(salva).toMatchObject({ id: NOVA, texto: 'Chuva forte das 14h às 15h.', minha: true, editado_em: null })
    await repo.salvarObservacao(nova())
    const dia = await criarRepositorioFixture({ persistencia }).observacoesDoDia(HTO)
    expect(dia.observacoes.filter((o) => o.id === NOVA)).toHaveLength(1)
    expect(dia.observacoes).toHaveLength(3)
  })

  it('só o autor edita ou exclui; a edição marca editado_em', async () => {
    const repo = criarRepositorioFixture()
    await expect(repo.salvarObservacao(nova({ id: DA_PATRICIO, texto: 'outro' }))).rejects.toMatchObject({
      tipo: 'permissao',
      message: 'Só o autor pode alterar a observação',
    })
    await expect(repo.excluirObservacao(DA_PATRICIO)).rejects.toMatchObject({ tipo: 'permissao' })

    const editada = await repo.salvarObservacao(nova({ id: MINHA, texto: 'Texto corrigido' }))
    expect(editada.texto).toBe('Texto corrigido')
    expect(editada.editado_em).not.toBeNull()

    await repo.excluirObservacao(MINHA)
    await repo.excluirObservacao(MINHA) // inexistente: sem erro
    expect((await repo.observacoesDoDia(HTO)).observacoes.map((o) => o.id)).toEqual([DA_PATRICIO])
  })

  it('valida o texto e a hora do aparelho', async () => {
    const repo = criarRepositorioFixture()
    await expect(repo.salvarObservacao(nova({ texto: '   ' }))).rejects.toMatchObject({ tipo: 'validacao' })
    await expect(repo.salvarObservacao(nova({ texto: 'x'.repeat(1001) }))).rejects.toMatchObject({
      tipo: 'validacao',
    })
    const futuro = new Date(Date.now() + 10 * 60_000).toISOString()
    await expect(repo.salvarObservacao(nova({ escritoEm: futuro }))).rejects.toMatchObject({ tipo: 'validacao' })
  })

  it('boletim emitido: o dia trava e salvar/editar/excluir respondem 22023 (validação)', async () => {
    const repo = criarRepositorioFixture({ boletimEmitido: true })
    const dia = await repo.observacoesDoDia(HTO)
    expect(dia.travada).toBe(true)
    expect(dia.observacoes.every((o) => o.travada)).toBe(true)
    const [a, m, d] = dia.data.split('-')
    const mensagem = `O boletim de ${d}/${m}/${a} já foi emitido; a correção é feita por retificação`
    await expect(repo.salvarObservacao(nova())).rejects.toMatchObject({ tipo: 'validacao', message: mensagem })
    await expect(repo.salvarObservacao(nova({ id: MINHA, texto: 'outro' }))).rejects.toMatchObject({
      message: mensagem,
    })
    await expect(repo.excluirObservacao(MINHA)).rejects.toMatchObject({ message: mensagem })
    // O reenvio idêntico continua idempotente, mesmo travado.
    const minha = dia.observacoes.find((o) => o.id === MINHA)!
    await expect(repo.salvarObservacao(nova({ id: MINHA, texto: minha.texto }))).resolves.toMatchObject({
      id: MINHA,
    })
  })

  it('sem sinal, salvar e excluir falham como rede', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const repo = criarRepositorioFixture()
    await expect(repo.salvarObservacao(nova())).rejects.toMatchObject({ tipo: 'rede' })
    await expect(repo.excluirObservacao(MINHA)).rejects.toMatchObject({ tipo: 'rede' })
  })
})
