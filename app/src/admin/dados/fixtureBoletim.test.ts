import { describe, expect, it } from 'vitest'
import { criarRepositorioAdminFixture } from './fixture.ts'
import { somarMeses } from './fixtureBoletim.ts'
import type { DadosEtapa } from './tipos.ts'

const nova = (extra: Partial<DadosEtapa> = {}): DadosEtapa => ({
  slug: 'teste',
  nome: 'TESTE',
  ordem: 9,
  sigla: 'T1',
  latitude: -3.7,
  longitude: -38.5,
  fuso: 'America/Fortaleza',
  ...extra,
})

describe('fixture: cadastro da etapa (como admin_obter_etapa / admin_salvar_etapa)', () => {
  it('a 2ª etapa traz os dados do exemplo, com prazo calculado e nada faltando', async () => {
    const repo = criarRepositorioAdminFixture()
    const e = await repo.obterEtapa('2a-etapa')
    expect(e).toMatchObject({
      sigla: '2',
      fuso: 'America/Fortaleza',
      latitude: -3.761,
      longitude: -38.5297,
      estacao: '8836',
      estacao_reserva: '9281',
      boletim_horario: '23:30',
      contrato: '120/2025 - SOP',
      os_data: '2025-06-02',
      vigencia_meses: 24,
      valor_original: 79499000,
      area_construida_m2: 86102.17,
    })
    expect(e.prazo).toEqual({
      termino_original: '2027-06-02',
      prazo_aditivos_dias: 90,
      termino_atual: '2027-08-31',
      valor_atual: 80749000,
    })
    expect(e.faltando).toEqual([])
    expect(e.aditivos).toHaveLength(1)
    expect(e.responsaveis).toEqual([
      { usuario_id: 'usuario-patricio', nome: 'Patrício Ferreira', nome_exibicao: 'CP PATRICIO', funcao: 'Fiscal', ordem: 0 },
    ])
  })

  it('a lista de etapas traz sigla e a quantidade de campos faltando', async () => {
    const repo = criarRepositorioAdminFixture()
    const lista = await repo.listarEtapas()
    expect(lista.map((e) => [e.slug, e.sigla, e.faltando])).toEqual([
      ['2a-etapa', '2', 0],
      ['3a-etapa', null, 15],
    ])
    expect((await repo.obterEtapa('3a-etapa')).prazo).toBeNull()
    await expect(repo.obterEtapa('x')).rejects.toThrow('Etapa não encontrada')
  })

  it('na criação, sigla, latitude, longitude e fuso são obrigatórios (com o nome do campo)', async () => {
    const repo = criarRepositorioAdminFixture()
    for (const campo of ['sigla', 'latitude', 'longitude', 'fuso'] as const) {
      const d = nova()
      delete d[campo]
      await expect(repo.salvarEtapa(d)).rejects.toThrow(campo)
    }
    const e = await repo.salvarEtapa(nova())
    // Sem estação informada: Montese e, de reserva, Benfica.
    expect(e).toMatchObject({ slug: 'teste', sigla: 'T1', boletim_horario: '23:30', estacao: '8836', estacao_reserva: '9281' })
    expect(e.faltando).not.toContain('estacao')
    expect(e.faltando).toContain('objeto')
    expect(e.faltando).not.toContain('sigla')
    expect(e.faltando).not.toContain('localizacao')
  })

  it('valida as colunas', async () => {
    const repo = criarRepositorioAdminFixture()
    const casos: [Partial<DadosEtapa>, string][] = [
      [{ sigla: 'ab' }, 'Sigla inválida'],
      [{ sigla: '12345678901' }, 'Sigla inválida'],
      [{ sigla: '2' }, 'Já existe uma etapa com a sigla 2'],
      [{ latitude: 10 }, 'Latitude fora do Brasil'],
      [{ longitude: -20 }, 'Longitude fora do Brasil'],
      [{ fuso: 'America/New_York' }, 'Fuso inválido'],
      [{ estacao: 'A305' }, 'Código de estação inválido'],
      [{ estacao: '12' }, 'Código de estação inválido'],
      [{ estacao: '8836', estacao_reserva: '8836' }, 'reserva precisa ser diferente'],
      [{ estacao_reserva: '8836' }, 'reserva precisa ser diferente'],
      [{ boletim_horario: '25:00' }, 'Horário do boletim inválido'],
      [{ boletim_horario: null }, 'não pode ser apagado'],
      [{ contratada_cnpj: '123' }, 'CNPJ inválido'],
      [{ os_data: '2025-02-30' }, 'Data da OS inválida'],
      [{ vigencia_meses: 0 }, 'entre 1 e 240'],
      [{ vigencia_meses: 241 }, 'entre 1 e 240'],
      [{ valor_original: -1 }, 'não pode ser negativo'],
      [{ area_construida_m2: 0 }, 'maior que zero'],
      [{ endereco: 'x'.repeat(301) }, 'até 300 caracteres'],
      [{ objeto: 'x'.repeat(601) }, 'até 600 caracteres'],
    ]
    for (const [extra, msg] of casos) {
      await expect(repo.salvarEtapa(nova(extra)), JSON.stringify(extra)).rejects.toThrow(msg)
    }
    expect((await repo.listarEtapas()).map((e) => e.slug)).toEqual(['2a-etapa', '3a-etapa'])
  })

  it('na edição, chave ausente mantém, null apaga e texto vazio vira null', async () => {
    const repo = criarRepositorioAdminFixture()
    const antes = await repo.obterEtapa('2a-etapa')
    const e = await repo.salvarEtapa({ id: 'etapa-2a', nome: '2ª ETAPA', ordem: 2, objeto: null, local: '  ', contrato: ' 5/2026 ' })
    expect(e.objeto).toBeNull()
    expect(e.local).toBeNull()
    expect(e.contrato).toBe('5/2026')
    expect(e.contratada).toBe(antes.contratada)
    expect(e.latitude).toBe(antes.latitude)
    expect(e.faltando).toEqual(['objeto', 'local'])
    await expect(repo.salvarEtapa({ id: 'etapa-2a', nome: 'x', ordem: 2, latitude: null })).rejects.toThrow('latitude e longitude juntas')
    await expect(repo.salvarEtapa({ id: 'etapa-2a', nome: 'x', ordem: 2, sigla: null })).rejects.toThrow('sigla não pode ser apagada')
    await expect(repo.salvarEtapa({ id: 'etapa-2a', nome: 'x', ordem: 2, fuso: null })).rejects.toThrow('fuso não pode ser apagado')
    await expect(repo.salvarEtapa({ id: 'etapa-2a', nome: 'x', ordem: 2, sigla: '3' })).resolves.toMatchObject({ sigla: '3' })
    await expect(repo.salvarEtapa({ id: 'etapa-3a', nome: 'x', ordem: 2, sigla: '3' })).rejects.toThrow('sigla 3')
  })

  it('prazo e valor atual acompanham os aditivos (inclusive supressão); sem data da OS não há prazo', async () => {
    const repo = criarRepositorioAdminFixture()
    const a = await repo.salvarAditivo({ etapa_id: 'etapa-2a', numero: '2º TA', data: '2026-09-01', prazo_dias: -30, valor: -1000.5, descricao: ' ' })
    expect(a).toMatchObject({ numero: '2º TA', descricao: null, valor: -1000.5 })
    let e = await repo.obterEtapa('2a-etapa')
    expect(e.prazo).toMatchObject({ prazo_aditivos_dias: 60, termino_atual: '2027-08-01', valor_atual: 80747999.5 })
    await expect(repo.salvarAditivo({ etapa_id: 'etapa-2a', numero: '2º TA', data: '2026-09-02', prazo_dias: 0, valor: 0, descricao: null })).rejects.toThrow('Já existe o aditivo 2º TA')
    await repo.salvarAditivo({ id: a.id, etapa_id: 'etapa-2a', numero: '2º TA', data: '2026-09-01', prazo_dias: 0, valor: 0, descricao: null })
    await repo.removerAditivo('aditivo-1')
    e = await repo.obterEtapa('2a-etapa')
    expect(e.prazo).toMatchObject({ prazo_aditivos_dias: 0, termino_atual: '2027-06-02', valor_atual: 79499000 })
    await expect(repo.removerAditivo('nao-existe')).rejects.toThrow('Aditivo não encontrado')
    await repo.salvarEtapa({ id: 'etapa-2a', nome: '2ª ETAPA', ordem: 2, os_data: null })
    expect((await repo.obterEtapa('2a-etapa')).prazo).toBeNull()
  })

  it('valida o aditivo', async () => {
    const repo = criarRepositorioAdminFixture()
    const base = { etapa_id: 'etapa-2a', numero: '9', data: '2026-01-01', prazo_dias: 0, valor: 0, descricao: null }
    await expect(repo.salvarAditivo({ ...base, numero: ' ' })).rejects.toThrow('número do aditivo')
    await expect(repo.salvarAditivo({ ...base, data: '01/01/2026' })).rejects.toThrow('Data do aditivo inválida')
    await expect(repo.salvarAditivo({ ...base, prazo_dias: 1.5 })).rejects.toThrow('número inteiro de dias')
    await expect(repo.salvarAditivo({ ...base, descricao: 'x'.repeat(301) })).rejects.toThrow('até 300')
    await expect(repo.salvarAditivo({ ...base, etapa_id: 'x' })).rejects.toThrow('Etapa não encontrada')
  })

  it('responsáveis: substitui a lista, mantém a ordem, usa "Fiscal" sem função e recusa repetido ou inexistente', async () => {
    const repo = criarRepositorioAdminFixture()
    const r = await repo.definirResponsaveis('etapa-2a', [
      { usuario_id: 'usuario-maria', funcao: ' ' },
      { usuario_id: 'usuario-patricio', funcao: 'Gestor' },
    ])
    expect(r.map((x) => [x.usuario_id, x.funcao, x.ordem])).toEqual([
      ['usuario-maria', 'Fiscal', 0],
      ['usuario-patricio', 'Gestor', 1],
    ])
    await expect(
      repo.definirResponsaveis('etapa-2a', [
        { usuario_id: 'usuario-maria', funcao: 'A' },
        { usuario_id: 'usuario-maria', funcao: 'B' },
      ]),
    ).rejects.toThrow('repetido')
    await expect(repo.definirResponsaveis('etapa-2a', [{ usuario_id: 'x', funcao: 'A' }])).rejects.toThrow('Usuário não encontrado')
    expect((await repo.obterEtapa('2a-etapa')).responsaveis).toHaveLength(2)
    await repo.definirResponsaveis('etapa-2a', [])
    expect((await repo.obterEtapa('2a-etapa')).faltando).toEqual(['responsaveis'])
  })

  it('estação: apaga com null (vira pendência do boletim) e aceita outra da lista', async () => {
    const repo = criarRepositorioAdminFixture()
    const e = await repo.obterEtapa('2a-etapa')
    const sem = await repo.salvarEtapa({ id: e.id, nome: e.nome, ordem: e.ordem, estacao: null })
    expect(sem.estacao).toBeNull()
    expect(sem.faltando).toEqual(['estacao'])
    const outra = await repo.salvarEtapa({ id: e.id, nome: e.nome, ordem: e.ordem, estacao: '9137' })
    expect(outra).toMatchObject({ estacao: '9137', estacao_reserva: '9281', faltando: [] })
  })

  it('nome de exibição: normaliza, tira com vazio, recusa mais de 60 e usuário inexistente', async () => {
    const repo = criarRepositorioAdminFixture()
    const r = await repo.definirNomeExibicao('usuario-maria', '  maria   souza ')
    expect(r).toEqual({ id: 'usuario-maria', nome: 'Maria Souza', nome_exibicao: 'MARIA SOUZA' })
    expect((await repo.listarPessoas()).find((p) => p.id === 'usuario-maria')?.nome_exibicao).toBe('MARIA SOUZA')
    expect((await repo.definirNomeExibicao('usuario-maria', '   ')).nome_exibicao).toBeNull()
    expect((await repo.definirNomeExibicao('usuario-maria', null)).nome_exibicao).toBeNull()
    await expect(repo.definirNomeExibicao('usuario-maria', 'x'.repeat(61))).rejects.toThrow('até 60')
    await expect(repo.definirNomeExibicao('nao-existe', 'A')).rejects.toThrow('Usuário não encontrado')
  })

  it('pessoas: ordenadas pelo nome de exibição ou do Telegram, com as participações', async () => {
    const repo = criarRepositorioAdminFixture()
    const pessoas = await repo.listarPessoas()
    expect(pessoas.map((p) => p.id)).toEqual(['usuario-patricio', 'usuario-eduardo', 'usuario-maria', 'usuario-teste'])
    expect(pessoas[0]).toMatchObject({ nome_exibicao: 'CP PATRICIO', eh_admin: true })
    expect(pessoas[0].participacoes).toEqual([{ obra_slug: 'hto', obra_nome: 'HTO', etapa_nome: '2ª ETAPA', papel: 'gestor' }])
  })

  it('só admin: as operações novas recusam quem não é', async () => {
    const repo = criarRepositorioAdminFixture({ admin: false })
    await expect(repo.listarPessoas()).rejects.toThrow('Acesso negado')
    await expect(repo.obterEtapa('2a-etapa')).rejects.toThrow('Acesso negado')
    await expect(repo.definirNomeExibicao('usuario-maria', 'A')).rejects.toThrow('Acesso negado')
    await expect(repo.listarBoletins('2a-etapa')).rejects.toThrow('Acesso negado')
    await expect(repo.pedirEmissao('2a-etapa', '2026-01-01')).rejects.toThrow('Acesso negado')
    await expect(repo.removerAditivo('aditivo-1')).rejects.toThrow('Acesso negado')
  })

  it('organização: traz o cabeçalho de exemplo, troca, limpa e valida', async () => {
    const repo = criarRepositorioAdminFixture()
    expect((await repo.obterOrganizacao()).cabecalho).toEqual([
      'COMANDO DA AERONÁUTICA',
      'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA',
      'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)',
    ])
    expect((await repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: null, cabecalho: [' A ', 'B'] })).cabecalho).toEqual(['A', 'B'])
    expect((await repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: null })).cabecalho).toEqual(['A', 'B'])
    await expect(repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: null, cabecalho: ['1', '2', '3', '4', '5'] })).rejects.toThrow('até 4 linhas')
    await expect(repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: null, cabecalho: [''] })).rejects.toThrow('1 a 100')
    await expect(repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: null, cabecalho: ['x'.repeat(101)] })).rejects.toThrow('1 a 100')
    expect((await repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: null, cabecalho: [] })).cabecalho).toEqual([])
  })

  it('somarMeses ajusta o dia ao fim do mês', () => {
    expect(somarMeses('2025-01-31', 1)).toBe('2025-02-28')
    expect(somarMeses('2025-06-02', 24)).toBe('2027-06-02')
    expect(somarMeses('2025-11-15', 3)).toBe('2026-02-15')
  })
})
