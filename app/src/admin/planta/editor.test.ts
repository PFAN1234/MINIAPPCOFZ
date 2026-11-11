import { describe, expect, it } from 'vitest'
import ambientesHto from '../../../../data/hto/ambientes.json'
import { criarRepositorioAdminFixture } from '../dados/fixture.ts'
import { criarServicoFalso, spansDosAmbientes } from '../telas/planta/servicoFalso.ts'
import {
  baseDoBanco,
  configParaSalvar,
  edicaoInicial,
  extrairPavimento,
  moverPino,
  problemaRevisao,
  removerPino,
  renomearAmbiente,
} from './editor.ts'
import { montarPayload, publicarPavimento } from './publicar.ts'
import { calcularPlanta } from './plantas.ts'

const W = 2383.919921875
const H = 1683.719970703125
const doTerreo = ambientesHto.ambientes.filter((a) => a.pavimento === 'terreo')
const pagina = { largura: W, altura: H, spans: spansDosAmbientes(doTerreo, W, H) }

async function dadosHto() {
  return criarRepositorioAdminFixture().obterEditorPlanta('hto')
}

describe('editor: base do banco e extração do pavimento', () => {
  it('a base é só o pavimento e a extração bate com o banco (sem diferenças)', async () => {
    const dados = await dadosHto()
    const base = baseDoBanco(dados, 'terreo')!
    expect(base.ambientes).toHaveLength(44)
    expect(base.ambientes!.every((a) => a.pavimento === 'terreo')).toBe(true)
    const { resultado, ignorados } = extrairPavimento(dados, 'terreo', edicaoInicial(dados, 'terreo'), pagina)
    expect(resultado.ambientes.map((a) => a.id)).toEqual(doTerreo.map((a) => a.id))
    expect(resultado.diferencas.novos).toEqual([])
    expect(resultado.diferencas.removidos).toEqual([])
    expect(ignorados).toEqual([])
  })

  it('entradas antigas que não batem com a planta são ignoradas e relatadas', async () => {
    const dados = await dadosHto()
    const e = edicaoInicial(dados, 'terreo')
    e.renomear.push({ pavimento: 'terreo', nome_planta: 'COPA', area_m2: 99, nome_operacional: 'X' })
    e.manter_codigo['terreo-nao-existe'] = 'terreo-apto-101'
    e.marcadores_ajustados['terreo-sumiu'] = { revisao: e.revisao, marcadores: [{ x: 0.5, y: 0.5 }] }
    const { ignorados } = extrairPavimento(dados, 'terreo', e, pagina)
    expect(ignorados).toHaveLength(3)
  })

  it('pino arrastado e pino extra removido entram em marcadores_ajustados e nas diferenças', async () => {
    const dados = await dadosHto()
    let e = edicaoInicial(dados, 'terreo')
    const r0 = extrairPavimento(dados, 'terreo', e, pagina).resultado
    const apto = r0.ambientes.find((a) => a.id === 'terreo-apto-101')!
    e = moverPino(e, apto, 0, apto.marcadores[0].x + 0.05, apto.marcadores[0].y)
    const circ = r0.ambientes.find((a) => a.marcadores.length > 1)!
    e = removerPino(e, circ, 1)
    const r = extrairPavimento(dados, 'terreo', e, pagina).resultado
    expect(r.ambientes.find((a) => a.id === circ.id)!.marcadores).toHaveLength(1)
    expect(r.diferencas.marcador_deslocado.map((d) => d.id).sort()).toEqual([circ.id, 'terreo-apto-101'].sort())
    expect(() => removerPino(e, r.ambientes.find((a) => a.id === circ.id)!, 0)).toThrow('ao menos um pino')
  })

  it('renomear ambiente publicado mantém o código; configuração preserva o outro pavimento', async () => {
    const dados = await dadosHto()
    dados.config!.manter_codigo = { '1pav-x': '1pav-apto-201' }
    let e = edicaoInicial(dados, 'terreo')
    const a = extrairPavimento(dados, 'terreo', e, pagina).resultado.ambientes.find((x) => x.id === 'terreo-apto-101')!
    e = renomearAmbiente(dados, e, a, 'Apto. 101 (PcD)')
    const ext = extrairPavimento(dados, 'terreo', e, pagina)
    expect(ext.resultado.ambientes.find((x) => x.nome_operacional === 'Apto. 101 (PcD)')?.id).toBe('terreo-apto-101')
    expect(ext.resultado.diferencas.herdados).toEqual([
      {
        id: 'terreo-apto-101',
        id_calculado: 'terreo-apto-101-pcd',
        pavimento: 'terreo',
        nome_antes: 'Apto. 101',
        nome_operacional: 'Apto. 101 (PcD)',
        reativado: false,
      },
    ])

    e = { ...e, pranchaParaTodos: false, pdfNome: 'NOVO-R05.pdf' }
    const cfg = configParaSalvar(dados, 'terreo', e, ext.config)
    expect(cfg.manter_codigo).toEqual({ '1pav-x': '1pav-apto-201', 'terreo-apto-101-pcd': 'terreo-apto-101' })
    expect(cfg.renomear).toEqual([
      { pavimento: 'terreo', nome_planta: 'APTO. 101', area_m2: 23.88, nome_operacional: 'Apto. 101 (PcD)' },
    ])
    const pavs = cfg.pavimentos as { codigo: string; pdf: string; prancha?: unknown; revisao?: string }[]
    expect(pavs.find((p) => p.codigo === 'terreo')).toMatchObject({ pdf: 'NOVO-R05.pdf', revisao: 'R05' })
    expect(pavs.find((p) => p.codigo === 'terreo')!.prancha).toEqual(e.prancha)
    expect(pavs.find((p) => p.codigo === '1pav')).toEqual({ codigo: '1pav', pdf: 'CE01-14PE01-ARQ-DE018-R05.pdf', pagina: 1 })
    expect(cfg.status).toBe('aguardando_revisao_humana')
  })

  it('revisão informada é validada contra o nome do arquivo', () => {
    expect(problemaRevisao('', 'x.pdf')).toMatch(/Informe/)
    expect(problemaRevisao('R 1', 'x.pdf')).toMatch(/inválida/)
    expect(problemaRevisao('R07', 'X-R06.pdf')).toMatch(/é da revisão R06/)
    expect(problemaRevisao('r06', 'X-R06.pdf')).toBeNull()
  })
})

describe('publicação', () => {
  it('payload com caminhos do contrato e o mesmo conteúdo do seed', async () => {
    const dados = await dadosHto()
    const e = { ...edicaoInicial(dados, 'terreo'), pdfNome: 'P-R05.pdf' }
    const extracao = extrairPavimento(dados, 'terreo', e, pagina)
    const calculada = calcularPlanta(e.prancha, pagina, extracao.resultado.ambientes)
    const p = montarPayload({ dados, pav: 'terreo', edicao: e, extracao, calculada, pdf: { nome: 'P-R05.pdf', bytes: new Uint8Array(), sha256: 'a'.repeat(64) } })
    expect(p.pavimentos[0].pdf.path).toBe(`obra-hto/R05/terreo/${'a'.repeat(64)}.pdf`)
    expect(p.pavimentos[0].imagem).toEqual({ largura: 2401, altura: 1944 })
    expect(p.pavimentos[0].imagem_hd).toEqual({ largura: 4097, altura: 3317 })
    expect(Object.keys(p.pavimentos[0].detalhes)).toHaveLength(44)
    expect(p.ambientes.map((a) => a.codigo)).toEqual(doTerreo.map((a) => a.id))
    expect(p.config_atualizada_em).toBe(dados.config_atualizada_em)
  })

  it('envia PDF e imagens antes da RPC e informa o progresso', async () => {
    const dados = await dadosHto()
    const e = { ...edicaoInicial(dados, 'terreo'), pdfNome: 'P-R05.pdf' }
    const extracao = extrairPavimento(dados, 'terreo', e, pagina)
    const doc = await criarServicoFalso(pagina.spans, W, H).abrir(new Uint8Array())
    const chamadas: string[] = []
    const progresso: number[] = []
    await publicarPavimento({
      deps: {
        enviarArquivo: async (b, c, _a, tipo) => {
          chamadas.push(`${b}:${c.split('/').slice(3).join('/') || c.split('/').pop()}:${tipo}`)
        },
        publicarRevisao: async () => {
          chamadas.push('rpc')
          return { publicacoes: [], ambientes_ativos: 44, inativados: 0 }
        },
      },
      dados,
      pav: 'terreo',
      edicao: e,
      extracao,
      pagina: await doc.pagina(1),
      pdf: { nome: 'P-R05.pdf', bytes: new Uint8Array([1]), sha256: 'b'.repeat(64) },
      aoProgredir: (x) => progresso.push(x.feito),
    })
    expect(chamadas[0]).toBe(`originais:${'b'.repeat(64)}.pdf:application/pdf`)
    expect(chamadas[1]).toBe('plantas:planta.webp:image/webp')
    expect(chamadas[2]).toBe('plantas:planta-hd.webp:image/webp')
    expect(chamadas.at(-1)).toBe('rpc')
    expect(chamadas).toHaveLength(1 + 2 + 44 + 1)
    expect(progresso.at(-1)).toBe(48)
  })
})
