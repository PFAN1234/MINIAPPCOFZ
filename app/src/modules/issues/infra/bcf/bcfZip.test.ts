import { strToU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { issueParaTopicoBcf, type PacoteBcf } from '../../domain/bcf.ts'
import type { Issue } from '../../domain/issues.ts'
import { ErroBcf, escreverBcf, lerBcf } from './bcfZip.ts'
import { BCF21, BCF30, GLOBAL_ID_A, GLOBAL_ID_B, GUID_C1, GUID_T1, GUID_T2, GUID_VP1, PNG_1X1, zipDe } from './__fixtures__/pacotes.ts'

describe('lerBcf: BCF 2.1 de ferramenta real', () => {
  const p = lerBcf(zipDe(BCF21))
  const t = p.topicos[0]

  it('lê versão, projeto e o tópico', () => {
    expect(p.versao).toBe('2.1')
    expect(p.projeto).toEqual({ id: '99999999-0000-4000-8000-000000000009', nome: 'Edifício HTO' })
    expect(p.topicos).toHaveLength(1)
    expect(t).toMatchObject({
      guid: GUID_T1,
      tipo: 'Clash',
      status: 'Active',
      prioridade: 'Major',
      titulo: 'Viga atravessa o shaft',
      descricao: 'Rever a posição da viga V12 & do tubo de 100 mm.',
      autor: 'maria@projetos.test',
      prazo: '2026-12-05T00:00:00-03:00',
      responsavel: 'joao@projetos.test',
      etapa: 'Projeto executivo',
      etiquetas: ['Estrutura', 'Hidráulica'],
    })
  })

  it('lê comentários com a ligação ao viewpoint', () => {
    expect(t.comentarios).toHaveLength(2)
    expect(t.comentarios[0]).toMatchObject({ guid: GUID_C1, autor: 'joao@projetos.test', texto: 'Vou avisar a hidráulica.', viewpointGuid: GUID_VP1 })
    expect(t.comentarios[1].viewpointGuid).toBeNull()
  })

  it('lê viewpoint: câmera, corte, seleção, visibilidade e snapshot', () => {
    expect(t.viewpoints).toHaveLength(1)
    const vp = t.viewpoints[0]
    expect(vp.guid).toBe(GUID_VP1)
    expect(vp.camera).toMatchObject({ projecao: 'perspectiva', posicao: [12, -3, 5.5], direcao: [0, 1, 0], cima: [0, 0, 1], campo: 60 })
    expect(vp.planos).toEqual([{ origem: [0, 0, 3], direcao: [0, 0, -1] }])
    expect(vp.selecionados).toEqual([GLOBAL_ID_A, GLOBAL_ID_B])
    expect(vp.visibilidadePadrao).toBe(true)
    expect(vp.excecoes).toEqual([GLOBAL_ID_B])
    expect(Array.from(vp.snapshot ?? [])).toEqual(Array.from(PNG_1X1))
  })
})

describe('lerBcf: BCF 3.0 de ferramenta real', () => {
  const p = lerBcf(zipDe(BCF30))
  const t = p.topicos[0]

  it('lê versão, projeto (ProjectInfo) e o tópico com Label', () => {
    expect(p.versao).toBe('3.0')
    expect(p.projeto?.nome).toBe('Edifício HTO')
    expect(t).toMatchObject({
      guid: GUID_T2,
      tipo: 'Request',
      status: 'Resolved',
      prioridade: 'Critical',
      etiquetas: ['Arquitetura', 'Esquadrias'],
      autor: 'ana@projetos.test',
      responsavel: 'eduardo@projetos.test',
      descricao: 'Peitoril a 1,10 m?',
    })
  })

  it('lê Comments e ViewPoints dentro de Topic; ortográfica; visibilidade padrão falsa', () => {
    expect(t.comentarios).toHaveLength(1)
    expect(t.comentarios[0].viewpointGuid).toBe('aaaaaaaa-2222-4222-8222-00000000000b')
    const vp = t.viewpoints[0]
    expect(vp.camera).toMatchObject({ projecao: 'ortografica', posicao: [5, 5, 40], campo: 25 })
    expect(vp.visibilidadePadrao).toBe(false)
    expect(vp.excecoes).toEqual([GLOBAL_ID_A])
    expect(vp.snapshot?.[0]).toBe(0xff) // JPEG
  })
})

describe('lerBcf: erros', () => {
  it('não é zip', () => {
    expect(() => lerBcf(strToU8('isto não é um zip'))).toThrow(ErroBcf)
    expect(() => lerBcf(strToU8('isto não é um zip'))).toThrow(/não é um \.bcfzip/)
  })

  it('zip sem bcf.version', () => {
    expect(() => lerBcf(zipDe({ 'a.txt': 'x' }))).toThrow(/falta o bcf\.version/)
  })

  it('versão não suportada', () => {
    const v = '<Version VersionId="1.0"/>'
    expect(() => lerBcf(zipDe({ 'bcf.version': v }))).toThrow(/Versão BCF 1\.0 não suportada/)
  })

  it('XML quebrado no markup', () => {
    expect(() => lerBcf(zipDe({ ...BCF21, [`${GUID_T1}/markup.bcf`]: '<Markup><Topic' }))).toThrow(/XML legível/)
  })

  it('pacote sem tópicos é válido e vazio', () => {
    expect(lerBcf(zipDe({ 'bcf.version': BCF21['bcf.version'] })).topicos).toEqual([])
  })
})

function issueDe(): Issue {
  return {
    id: 'i1',
    numero: 1,
    guid: GUID_T1,
    titulo: 'Título <com> & "símbolos"',
    descricao: 'Linha 1\nLinha 2\n\n[BCF] Etiquetas: a, b',
    tipo: 'duvida',
    prioridade: 'critica',
    status: 'resolvida',
    responsavelId: null,
    responsavelNome: 'Eduardo',
    prazo: '2026-12-05',
    criadoPor: null,
    criadoPorNome: 'Patrício',
    criadoEm: '2026-11-12T13:00:00.000Z',
    atualizadoEm: '2026-11-13T09:30:00.000Z',
    vistas: [
      {
        id: 'v1',
        guid: GUID_VP1,
        vista: {
          camera: { posicao: [1, 2, 3], alvo: [1, 2, 0], projecao: 'ortografica', campo: 12.5 },
          cortes: [{ origem: [0, 1, 0], normal: [1, 0, 0] }],
          selecionados: [{ sigla: 'ARQ', globalId: GLOBAL_ID_A }],
          ocultos: [{ sigla: 'ARQ', globalId: GLOBAL_ID_B }],
          isolados: null,
        },
        imagemPath: null,
        criadoEm: '2026-11-12T13:00:00.000Z',
      },
    ],
    comentarios: [{ id: 'c1', guid: GUID_C1, autorId: null, autorNome: 'Eduardo', texto: 'Oi & tchau', vistaId: 'v1', criadoEm: '2026-11-13T09:30:00.000Z' }],
  }
}

describe.each(['2.1', '3.0'] as const)('escreverBcf → lerBcf, versão %s', (versao) => {
  const topico = issueParaTopicoBcf(issueDe(), { imagens: new Map([[GUID_VP1, PNG_1X1]]) })
  const pacote: PacoteBcf = { versao, projeto: { id: '99999999-0000-4000-8000-000000000009', nome: 'HTO & Cia' }, topicos: [topico] }
  const bytes = escreverBcf(pacote)
  const volta = lerBcf(bytes)

  it('gera os arquivos esperados', () => {
    const nomes = Object.keys(unzipSync(bytes)).sort()
    expect(nomes).toEqual(
      ['bcf.version', 'project.bcfp', `${GUID_T1}/markup.bcf`, `${GUID_T1}/${GUID_VP1}.bcfv`, `${GUID_T1}/${GUID_VP1}.png`].sort(),
    )
  })

  it('preserva versão, projeto e o tópico inteiro', () => {
    expect(volta.versao).toBe(versao)
    expect(volta.projeto).toEqual({ id: '99999999-0000-4000-8000-000000000009', nome: 'HTO & Cia' })
    expect(volta.topicos).toHaveLength(1)
    const t = volta.topicos[0]
    expect(t).toMatchObject({
      guid: GUID_T1,
      tipo: 'Request',
      status: 'Resolved',
      prioridade: 'Critical',
      titulo: 'Título <com> & "símbolos"',
      descricao: 'Linha 1\nLinha 2',
      etiquetas: ['a', 'b'],
      autor: 'Patrício',
      responsavel: 'Eduardo',
      criadoEm: '2026-11-12T13:00:00.000Z',
    })
    expect(t.prazo?.slice(0, 10)).toBe('2026-12-05')
    expect(t.comentarios).toEqual([
      { guid: GUID_C1, data: '2026-11-13T09:30:00.000Z', autor: 'Eduardo', texto: 'Oi & tchau', viewpointGuid: GUID_VP1 },
    ])
  })

  it('preserva o viewpoint (câmera ortográfica, corte, seleção, ocultos) e o snapshot', () => {
    const vp = volta.topicos[0].viewpoints[0]
    expect(vp).toEqual({ ...topico.viewpoints[0], snapshot: expect.any(Uint8Array) })
    expect(Array.from(vp.snapshot ?? [])).toEqual(Array.from(PNG_1X1))
  })
})

describe('escreverBcf: casos de borda', () => {
  it('viewpoint sem snapshot não gera png; sem projeto não gera project.bcfp', () => {
    const topico = issueParaTopicoBcf(issueDe())
    const bytes = escreverBcf({ versao: '2.1', projeto: null, topicos: [topico] })
    const nomes = Object.keys(unzipSync(bytes))
    expect(nomes.some((n) => n.endsWith('.png'))).toBe(false)
    expect(nomes).not.toContain('project.bcfp')
    expect(lerBcf(bytes).topicos[0].viewpoints[0].snapshot).toBeNull()
  })

  it('snapshot que não é PNG fica de fora (o formato gerado é PNG)', () => {
    const topico = issueParaTopicoBcf(issueDe(), { imagens: new Map([[GUID_VP1, Uint8Array.from([0xff, 0xd8, 0xff])]]) })
    expect(Object.keys(unzipSync(escreverBcf({ versao: '3.0', projeto: null, topicos: [topico] }))).some((n) => n.endsWith('.png'))).toBe(false)
  })

  it('3.0 guarda Comments e ViewPoints dentro de Topic; 2.1 ao lado', () => {
    const topico = issueParaTopicoBcf(issueDe())
    const xml = (v: '2.1' | '3.0') => new TextDecoder().decode(unzipSync(escreverBcf({ versao: v, projeto: null, topicos: [topico] }))[`${GUID_T1}/markup.bcf`])
    expect(xml('3.0')).toMatch(/<Comments>.*<\/Comments><ViewPoints>.*<\/ViewPoints><\/Topic>/s)
    expect(xml('2.1')).toMatch(/<\/Topic><Comment Guid=.*<Viewpoints Guid=/s)
  })
})
