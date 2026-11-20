import { describe, expect, it } from 'vitest'
import type { EtapasAdminRepositorio } from './EtapasAdminRepositorio.port.ts'

/**
 * Comportamento que toda implementação de `EtapasAdminRepositorio` deve cumprir (fixture).
 * Semente esperada: etapa `2a-etapa` (id `etapa-2a`, sigla `2`, com um aditivo `1º TA` e o responsável
 * `usuario-patricio`), etapa `3a-etapa` (sigla `3`) e a obra `hto` na 2ª etapa; usuário `usuario-eduardo` existe.
 */
export function contratoEtapasAdminRepositorio(nome: string, criar: () => EtapasAdminRepositorio) {
  const nova = { nome: 'Etapa Nova', ordem: 9, slug: 'nova', sigla: 'N', latitude: -3.7, longitude: -38.5, fuso: 'America/Fortaleza' }

  describe(`EtapasAdminRepositorio (${nome})`, () => {
    it('cria etapa nova, edita pelo id e recusa slug ou sigla repetidos', async () => {
      const repo = criar()
      const criada = await repo.salvarEtapa(nova)
      expect(criada.slug).toBe('nova')
      expect((await repo.listarEtapas()).map((e) => e.slug)).toContain('nova')
      const editada = await repo.salvarEtapa({ id: criada.id, nome: 'Renomeada', ordem: 9 })
      expect(editada.nome).toBe('Renomeada')
      expect(editada.sigla).toBe('N')
      await expect(repo.salvarEtapa({ ...nova, sigla: 'X' })).rejects.toThrow('slug nova')
      await expect(repo.salvarEtapa({ ...nova, slug: 'outra', sigla: '2' })).rejects.toThrow('sigla 2')
      await expect(repo.salvarEtapa({ ...nova, slug: 'Inválido!' })).rejects.toThrow('Slug inválido')
    })

    it('obterEtapa devolve o cadastro e recusa slug inexistente', async () => {
      const repo = criar()
      const e = await repo.obterEtapa('2a-etapa')
      expect(e.aditivos).toHaveLength(1)
      expect(e.responsaveis.map((r) => r.usuario_id)).toEqual(['usuario-patricio'])
      await expect(repo.obterEtapa('nao-existe')).rejects.toThrow('Etapa não encontrada')
    })

    it('aditivos: cria, edita, recusa número repetido e remove', async () => {
      const repo = criar()
      const base = { etapa_id: 'etapa-2a', numero: '2º TA', data: '2026-05-01', prazo_dias: 30, valor: 1000.555, descricao: null }
      const a = await repo.salvarAditivo(base)
      expect(a.valor).toBe(1000.56)
      expect((await repo.salvarAditivo({ ...base, id: a.id, prazo_dias: 45 })).prazo_dias).toBe(45)
      await expect(repo.salvarAditivo({ ...base, numero: '1º TA' })).rejects.toThrow('Já existe o aditivo 1º TA')
      await repo.removerAditivo(a.id)
      expect((await repo.obterEtapa('2a-etapa')).aditivos.map((x) => x.numero)).toEqual(['1º TA'])
      await expect(repo.removerAditivo(a.id)).rejects.toThrow('Aditivo não encontrado')
    })

    it('definirResponsaveis substitui a lista na ordem e recusa repetido ou usuário inexistente', async () => {
      const repo = criar()
      const r = await repo.definirResponsaveis('etapa-2a', [
        { usuario_id: 'usuario-eduardo', funcao: ' ' },
        { usuario_id: 'usuario-patricio', funcao: 'Chefe' },
      ])
      expect(r.map((x) => [x.usuario_id, x.funcao, x.ordem])).toEqual([
        ['usuario-eduardo', 'Fiscal', 0],
        ['usuario-patricio', 'Chefe', 1],
      ])
      await expect(
        repo.definirResponsaveis('etapa-2a', [
          { usuario_id: 'usuario-eduardo', funcao: 'a' },
          { usuario_id: 'usuario-eduardo', funcao: 'b' },
        ]),
      ).rejects.toThrow('repetido')
      await expect(repo.definirResponsaveis('etapa-2a', [{ usuario_id: 'ninguem', funcao: 'a' }])).rejects.toThrow('Usuário não encontrado')
      expect(await repo.definirResponsaveis('etapa-2a', [])).toEqual([])
    })

    it('arquivarEtapa arquiva e desarquiva; desvincularEtapa desliga o grupo do Telegram', async () => {
      const repo = criar()
      expect(await repo.arquivarEtapa('2a-etapa', true)).not.toBeNull()
      expect((await repo.listarEtapas()).find((e) => e.slug === '2a-etapa')!.arquivada_em).not.toBeNull()
      expect(await repo.arquivarEtapa('2a-etapa', false)).toBeNull()
      expect((await repo.obterEtapa('2a-etapa')).telegram_vinculado).toBe(true)
      await repo.desvincularEtapa('2a-etapa')
      expect((await repo.obterEtapa('2a-etapa')).telegram_vinculado).toBe(false)
    })

    it('resumoEtapa lista as obras e excluirEtapa exige o nome exato da etapa', async () => {
      const repo = criar()
      expect((await repo.resumoEtapa('2a-etapa')).obras.map((o) => o.slug)).toEqual(['hto'])
      await expect(repo.excluirEtapa('2a-etapa', 'errado')).rejects.toThrow('digite exatamente o nome da etapa')
      const r = await repo.excluirEtapa('2a-etapa', '2ª ETAPA')
      expect(r.exclusoes).toHaveLength(1)
      expect((await repo.listarEtapas()).map((e) => e.slug)).not.toContain('2a-etapa')
    })
  })
}
