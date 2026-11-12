// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { criarRepositorioAdminFixture } from '../dados/fixture.ts'
import { mensagemErroConversao, pastaWasm, textoEtapa } from './conversor.ts'
import {
  caminhoModelo,
  hashModelo,
  LIMITE_FRAG,
  pareceFrag,
  problemaFrag,
  problemaRevisaoModelo,
  problemaSigla,
  publicarModelo,
  siglaERevisao,
  tipoDoArquivo,
} from './modelos.ts'

// O .frag real da HTO (lido a partir de app/, a pasta do Vitest).
const fragHto = new Uint8Array(readFileSync('public/modelos/hto/ARQ.frag'))

describe('modelo: nome, sigla e validações', () => {
  it('sigla e revisão pelo padrão do script', () => {
    expect(siglaERevisao('CE01-14PE01-ARQ-R06.ifc')).toEqual({ sigla: 'ARQ', revisao: 'R06' })
    expect(siglaERevisao('ce01-14pe01-est-r02.IFC')).toEqual({ sigla: 'EST', revisao: 'R02' })
    expect(siglaERevisao('ARQ.frag')).toEqual({ sigla: null, revisao: null })
    expect(siglaERevisao('X-Y-ESTRUTURA-R1.ifc').sigla).toBeNull()
  })

  it('tipo do arquivo pela extensão', () => {
    expect(tipoDoArquivo('a.IFC')).toBe('ifc')
    expect(tipoDoArquivo('a.frag')).toBe('frag')
    expect(tipoDoArquivo('a.pdf')).toBeNull()
  })

  it('sigla e revisão inválidas', () => {
    expect(problemaSigla('ARQ')).toBeNull()
    expect(problemaSigla('arq')).toMatch(/2 a 4 letras/)
    expect(problemaSigla('ARQUI')).toMatch(/2 a 4 letras/)
    expect(problemaRevisaoModelo('')).toBeNull()
    expect(problemaRevisaoModelo('R 06')).toMatch(/Revisão inválida/)
  })

  it('.frag real passa; vazio, outro formato e acima do limite falham', () => {
    expect(pareceFrag(fragHto)).toBe(true)
    expect(problemaFrag(fragHto)).toBeNull()
    expect(problemaFrag(new Uint8Array())).toMatch(/vazio/)
    expect(problemaFrag(new TextEncoder().encode('ISO-10303-21;'))).toMatch(/não parece um \.frag/)
    const grande = new Uint8Array(LIMITE_FRAG + 1)
    grande.set([0x78, 0x9c])
    expect(problemaFrag(grande)).toMatch(/acima do limite de 50 MB/)
  })

  it('hash como o do script e caminho pelo conteúdo', async () => {
    // O manifesto do script registra dffa24c612d76690 para este arquivo.
    expect(await hashModelo(fragHto)).toBe('dffa24c612d76690')
    expect(caminhoModelo('obra-1', 'ARQ', 'dffa24c612d76690')).toBe('obra-1/ARQ/dffa24c612d76690.frag')
  })

  it('conversor: etapas, falta de memória e pasta do wasm', () => {
    expect(textoEtapa('geometries')).toBe('Lendo as geometrias')
    expect(textoEtapa('outra')).toBe('Convertendo')
    expect(mensagemErroConversao('RangeError: WebAssembly.Memory(): could not allocate memory')).toMatch(/npm run modelos/)
    expect(mensagemErroConversao('IFC sem cabeçalho')).toBe('Não foi possível converter o IFC: IFC sem cabeçalho')
    expect(pastaWasm('https://x.app')).toMatch(/^https:\/\/x\.app\/web-ifc\/\d+\.\d+\.\d+\/$/)
  })
})

describe('modelo: publicação (fixture)', () => {
  it('envia ao bucket modelos e registra; a mesma sigla substitui; retirar vai ao histórico', async () => {
    const repo = criarRepositorioAdminFixture()
    const obra = (await repo.obterObra('hto')).obra
    const deps = { enviarArquivo: repo.enviarArquivo.bind(repo), registrarModelo: repo.registrarModelo.bind(repo) }
    const m = await publicarModelo({ deps, obra, sigla: 'ARQ', revisao: 'R06', frag: fragHto, origem: 'frag', arquivoNome: 'ARQ.frag' })
    expect(m).toMatchObject({ sigla: 'ARQ', revisao: 'R06', bytes: fragHto.byteLength, hash: 'dffa24c612d76690' })
    expect(m.caminho).toBe(`${obra.id}/ARQ/dffa24c612d76690.frag`)

    const outro = new Uint8Array([0x78, 0x9c, 1, 2, 3])
    await publicarModelo({ deps, obra, sigla: 'ARQ', revisao: 'R07', frag: outro, origem: 'ifc', arquivoNome: 'X-Y-ARQ-R07.ifc', ifcBytes: 999 })
    let d = await repo.listarModelosAdmin('hto')
    expect(d.modelos).toHaveLength(1)
    expect(d.modelos[0]).toMatchObject({ revisao: 'R07', bytes: 5 })
    expect(d.historico.map((h) => [h.acao, h.revisao, h.origem])).toEqual([
      ['publicado', 'R07', 'ifc'],
      ['publicado', 'R06', 'frag'],
    ])

    await expect(
      publicarModelo({ deps, obra, sigla: 'arq', revisao: null, frag: outro, origem: 'frag', arquivoNome: 'a.frag' }),
    ).rejects.toThrow(/2 a 4 letras/)
    await expect(repo.registrarModelo('hto', { ...d.modelos[0], bytes: 6, origem: 'frag' })).rejects.toThrow(/não 6/)

    await repo.retirarModelo('hto', 'ARQ')
    d = await repo.listarModelosAdmin('hto')
    expect(d.modelos).toEqual([])
    expect(d.historico[0]).toMatchObject({ acao: 'retirado', sigla: 'ARQ' })
    await expect(repo.retirarModelo('hto', 'ARQ')).rejects.toThrow(/Não há modelo publicado/)
  })
})
