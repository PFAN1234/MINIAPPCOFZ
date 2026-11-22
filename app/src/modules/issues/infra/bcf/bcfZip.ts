/**
 * Leitura e escrita do `.bcfzip` (BCF 2.1 e 3.0): zip (fflate) + XML (DOMParser, strings escapadas).
 * Implementação própria em vez do `BCFTopics` do `@thatopen/components`: ele precisa de `Components`,
 * mundo com renderer e câmera (WebGL) e das vistas vivas; aqui o formato é lido e escrito direto,
 * o que dá ida e volta determinística e testável no vitest sem WebGL.
 *
 * Estrutura: `bcf.version`, `project.bcfp` (opcional) e uma pasta por tópico com `markup.bcf`,
 * `<viewpoint>.bcfv` e `<snapshot>.png`. A 3.0 põe `Comments` e `ViewPoints` dentro de `Topic`,
 * usa `<Labels><Label>` e `CreationAuthor`; a 2.1 põe `Comment` e `Viewpoints` ao lado de `Topic`.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { Ponto3 } from '../../../modelos/domain/central.ts'
import {
  AUTOR_DESCONHECIDO,
  type BcfCamera,
  type BcfComentario,
  type BcfTopico,
  type BcfViewpoint,
  type PacoteBcf,
  type VersaoBcf,
} from '../../domain/bcf.ts'

/** Arquivo que não é um `.bcfzip` legível ou de versão que o app não suporta (mensagem já pronta para a tela). */
export class ErroBcf extends Error {
  constructor(mensagem: string, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes)
    this.name = 'ErroBcf'
  }
}

// --- XML: leitura -------------------------------------------------------------------------------

function parseXml(texto: string, onde: string): Element {
  const doc = new DOMParser().parseFromString(texto.replace(/^\uFEFF/, ''), 'application/xml')
  const raiz = doc.documentElement
  if (!raiz || raiz.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new ErroBcf(`Arquivo BCF inválido: ${onde} não é um XML legível.`)
  }
  return raiz
}

const minusculo = (s: string) => s.toLowerCase()
const filhos = (el: Element, nome: string): Element[] =>
  Array.from(el.children).filter((c) => minusculo(c.localName) === minusculo(nome))
const filho = (el: Element | null | undefined, nome: string): Element | null => (el ? filhos(el, nome)[0] ?? null : null)
const atributo = (el: Element | null | undefined, nome: string): string | null => {
  if (!el) return null
  const a = Array.from(el.attributes).find((x) => minusculo(x.localName) === minusculo(nome))
  return a ? a.value : null
}
const textoDe = (el: Element | null | undefined): string | null => {
  const t = el?.textContent?.trim()
  return t ? t : null
}
const textoFilho = (el: Element | null | undefined, nome: string) => textoDe(filho(el, nome))
function todos(el: Element, nome: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((c) => minusculo(c.localName) === minusculo(nome))
}

function ponto(el: Element | null): Ponto3 | null {
  if (!el) return null
  const n = ['x', 'y', 'z'].map((k) => Number(textoFilho(el, k)))
  return n.every((v) => Number.isFinite(v)) && ['x', 'y', 'z'].every((k) => textoFilho(el, k) !== null)
    ? [n[0], n[1], n[2]]
    : null
}

// --- Zip ----------------------------------------------------------------------------------------

type Arquivos = Map<string, Uint8Array>

function abrirZip(dados: Uint8Array): Arquivos {
  let bruto: Record<string, Uint8Array>
  try {
    bruto = unzipSync(dados)
  } catch (e) {
    throw new ErroBcf('Arquivo BCF inválido: não é um .bcfzip (zip) legível.', { cause: e })
  }
  const mapa: Arquivos = new Map()
  for (const [nome, conteudo] of Object.entries(bruto)) {
    if (nome.endsWith('/')) continue
    mapa.set(nome.replace(/\\/g, '/').replace(/^\.?\//, ''), conteudo)
  }
  return mapa
}

/** Procura o arquivo sem diferenciar maiúsculas de minúsculas. */
function achar(arquivos: Arquivos, caminho: string): Uint8Array | null {
  const direto = arquivos.get(caminho)
  if (direto) return direto
  const alvo = minusculo(caminho)
  for (const [nome, dados] of arquivos) if (minusculo(nome) === alvo) return dados
  return null
}

const juntar = (pasta: string, nome: string) => (pasta ? `${pasta}/${nome}` : nome).replace(/\/{2,}/g, '/')

function lerVersao(arquivos: Arquivos): VersaoBcf {
  const bruto = achar(arquivos, 'bcf.version')
  if (!bruto) throw new ErroBcf('Arquivo BCF inválido: falta o bcf.version.')
  const id = atributo(parseXml(strFromU8(bruto), 'bcf.version'), 'VersionId')?.trim() ?? ''
  if (/^2\.[01](\.\d+)?$/.test(id)) return '2.1'
  if (/^3\.0(\.\d+)?$/.test(id)) return '3.0'
  throw new ErroBcf(`Versão BCF ${id || 'desconhecida'} não suportada: use um arquivo BCF 2.1 ou 3.0.`)
}

// --- Leitura ------------------------------------------------------------------------------------

function lerCamera(info: Element): BcfCamera | null {
  const ort = filho(info, 'OrthogonalCamera')
  const per = filho(info, 'PerspectiveCamera')
  const el = per ?? ort
  if (!el) return null
  const posicao = ponto(filho(el, 'CameraViewPoint'))
  const direcao = ponto(filho(el, 'CameraDirection'))
  if (!posicao || !direcao) return null
  const cima = ponto(filho(el, 'CameraUpVector')) ?? [0, 0, 1]
  const proporcao = Number(textoFilho(el, 'AspectRatio'))
  const campo = Number(textoFilho(el, per ? 'FieldOfView' : 'ViewToWorldScale'))
  return {
    projecao: per ? 'perspectiva' : 'ortografica',
    posicao,
    direcao,
    cima,
    proporcao: Number.isFinite(proporcao) && proporcao > 0 ? proporcao : 16 / 9,
    campo: Number.isFinite(campo) && campo > 0 ? campo : per ? 50 : 10,
  }
}

const idsDe = (el: Element | null): string[] =>
  el
    ? todos(el, 'Component')
        .map((c) => atributo(c, 'IfcGuid'))
        .filter((g): g is string => !!g)
    : []

function lerViewpoint(info: Element, guid: string, snapshot: Uint8Array | null): BcfViewpoint {
  const componentes = filho(info, 'Components')
  const visibilidade = filho(componentes, 'Visibility')
  const padrao = atributo(visibilidade, 'DefaultVisibility')
  return {
    guid,
    camera: lerCamera(info),
    planos: todos(info, 'ClippingPlane').flatMap((p) => {
      const origem = ponto(filho(p, 'Location'))
      const direcao = ponto(filho(p, 'Direction'))
      return origem && direcao ? [{ origem, direcao }] : []
    }),
    selecionados: idsDe(filho(componentes, 'Selection')),
    // Sem o elemento Visibility, tudo visível; com ele, o padrão do XSD do BCF é `false`.
    visibilidadePadrao: visibilidade ? padrao?.trim().toLowerCase() === 'true' : true,
    excecoes: idsDe(filho(visibilidade, 'Exceptions')),
    snapshot,
  }
}

function lerTopico(arquivos: Arquivos, caminhoMarkup: string): BcfTopico | null {
  const pasta = caminhoMarkup.includes('/') ? caminhoMarkup.slice(0, caminhoMarkup.lastIndexOf('/')) : ''
  const markup = parseXml(strFromU8(arquivos.get(caminhoMarkup) as Uint8Array), caminhoMarkup)
  const topico = todos(markup, 'Topic')[0]
  const guid = atributo(topico, 'Guid')?.trim()
  if (!topico || !guid) throw new ErroBcf(`Arquivo BCF inválido: ${caminhoMarkup} não tem o tópico com Guid.`)

  // 2.1: <Labels>x</Labels> repetido; 3.0: <Labels><Label>x</Label></Labels>.
  const etiquetas = filhos(topico, 'Labels').flatMap((l) => {
    const internos = filhos(l, 'Label')
    return (internos.length ? internos : [l]).map((e) => textoDe(e)).filter((e): e is string => !!e)
  })

  // Definição de viewpoint: elemento com Guid e filho Viewpoint/Snapshot (a referência de um
  // comentário não tem filhos).
  const viewpoints: BcfViewpoint[] = []
  for (const el of todos(markup, 'ViewPoints').concat(todos(markup, 'ViewPoint')).filter((e) => atributo(e, 'Guid'))) {
    if (minusculo(el.parentElement?.localName ?? '') === 'comment') continue
    const nomeBcfv = textoFilho(el, 'Viewpoint')
    const nomeSnap = textoFilho(el, 'Snapshot')
    if (!nomeBcfv && !nomeSnap) continue
    const vpGuid = (atributo(el, 'Guid') as string).trim()
    if (viewpoints.some((v) => v.guid === vpGuid)) continue
    const bruto = achar(arquivos, juntar(pasta, nomeBcfv ?? 'viewpoint.bcfv'))
    if (!bruto) continue
    const imagem = nomeSnap ? achar(arquivos, juntar(pasta, nomeSnap)) : null
    viewpoints.push(lerViewpoint(parseXml(strFromU8(bruto), nomeBcfv ?? 'viewpoint.bcfv'), vpGuid, imagem))
  }

  const comentarios: BcfComentario[] = todos(markup, 'Comment')
    .filter((c) => atributo(c, 'Guid') && ['markup', 'comments'].includes(minusculo(c.parentElement?.localName ?? '')))
    .map((c) => ({
      guid: (atributo(c, 'Guid') as string).trim(),
      data: textoFilho(c, 'Date'),
      autor: textoFilho(c, 'Author'),
      texto: textoFilho(c, 'Comment') ?? '',
      viewpointGuid: atributo(filho(c, 'Viewpoint'), 'Guid')?.trim() || null,
    }))

  return {
    guid,
    tipo: atributo(topico, 'TopicType'),
    status: atributo(topico, 'TopicStatus'),
    prioridade: textoFilho(topico, 'Priority'),
    titulo: textoFilho(topico, 'Title') ?? '',
    descricao: textoFilho(topico, 'Description'),
    criadoEm: textoFilho(topico, 'CreationDate'),
    autor: textoFilho(topico, 'CreationAuthor'),
    modificadoEm: textoFilho(topico, 'ModifiedDate'),
    modificadoPor: textoFilho(topico, 'ModifiedAuthor'),
    prazo: textoFilho(topico, 'DueDate'),
    responsavel: textoFilho(topico, 'AssignedTo'),
    etiquetas,
    etapa: textoFilho(topico, 'Stage'),
    viewpoints,
    comentarios,
  }
}

/** Lê um `.bcfzip` 2.1 ou 3.0. Lança `ErroBcf` se o arquivo não for um BCF válido ou for de outra versão. */
export function lerBcf(dados: Uint8Array): PacoteBcf {
  const arquivos = abrirZip(dados)
  const versao = lerVersao(arquivos)
  let projeto: PacoteBcf['projeto'] = null
  const bcfp = achar(arquivos, 'project.bcfp')
  if (bcfp) {
    const p = todos(parseXml(strFromU8(bcfp), 'project.bcfp'), 'Project').find((e) => atributo(e, 'ProjectId'))
    if (p) projeto = { id: (atributo(p, 'ProjectId') as string).trim(), nome: textoFilho(p, 'Name') ?? '' }
  }
  const topicos: BcfTopico[] = []
  for (const caminho of [...arquivos.keys()].sort()) {
    if (!/(^|\/)markup\.bcf$/i.test(caminho)) continue
    const t = lerTopico(arquivos, caminho)
    if (t) topicos.push(t)
  }
  return { versao, projeto, topicos }
}

// --- Escrita ------------------------------------------------------------------------------------

const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const CABECALHO = '<?xml version="1.0" encoding="UTF-8"?>\n'
const tag = (nome: string, valor: string | null | undefined) => (valor ? `<${nome}>${esc(valor)}</${nome}>` : '')
const xyz = (p: Ponto3) => `<X>${p[0]}</X><Y>${p[1]}</Y><Z>${p[2]}</Z>`
const componentes = (ids: string[]) => ids.map((g) => `<Component IfcGuid="${esc(g)}"/>`).join('')

function xmlViewpoint(vp: BcfViewpoint): string {
  const c = vp.camera
  const camera = c
    ? c.projecao === 'perspectiva'
      ? `<PerspectiveCamera><CameraViewPoint>${xyz(c.posicao)}</CameraViewPoint><CameraDirection>${xyz(c.direcao)}</CameraDirection><CameraUpVector>${xyz(c.cima)}</CameraUpVector><FieldOfView>${c.campo}</FieldOfView><AspectRatio>${c.proporcao}</AspectRatio></PerspectiveCamera>`
      : `<OrthogonalCamera><CameraViewPoint>${xyz(c.posicao)}</CameraViewPoint><CameraDirection>${xyz(c.direcao)}</CameraDirection><CameraUpVector>${xyz(c.cima)}</CameraUpVector><AspectRatio>${c.proporcao}</AspectRatio><ViewToWorldScale>${c.campo}</ViewToWorldScale></OrthogonalCamera>`
    : ''
  const planos = vp.planos.length
    ? `<ClippingPlanes>${vp.planos
        .map((p) => `<ClippingPlane><Location>${xyz(p.origem)}</Location><Direction>${xyz(p.direcao)}</Direction></ClippingPlane>`)
        .join('')}</ClippingPlanes>`
    : ''
  const selecao = vp.selecionados.length ? `<Selection>${componentes(vp.selecionados)}</Selection>` : ''
  const visibilidade = `<Visibility DefaultVisibility="${vp.visibilidadePadrao}">${
    vp.excecoes.length ? `<Exceptions>${componentes(vp.excecoes)}</Exceptions>` : ''
  }</Visibility>`
  return `${CABECALHO}<VisualizationInfo Guid="${esc(vp.guid)}"><Components>${selecao}${visibilidade}</Components>${camera}${planos}</VisualizationInfo>\n`
}

const nomeBcfv = (vp: BcfViewpoint) => `${vp.guid}.bcfv`
const nomePng = (vp: BcfViewpoint) => `${vp.guid}.png`

function ehPng(b: Uint8Array) {
  return b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
}

function xmlMarkup(t: BcfTopico, versao: VersaoBcf): string {
  const v3 = versao === '3.0'
  const etiquetas = v3
    ? t.etiquetas.length
      ? `<Labels>${t.etiquetas.map((e) => tag('Label', e)).join('')}</Labels>`
      : ''
    : t.etiquetas.map((e) => tag('Labels', e)).join('')
  const autor = t.autor || AUTOR_DESCONHECIDO
  const corpoTopico = [
    tag('Title', t.titulo),
    tag('Priority', t.prioridade),
    etiquetas,
    tag('CreationDate', t.criadoEm),
    tag('CreationAuthor', autor),
    tag('ModifiedDate', t.modificadoEm),
    tag('ModifiedAuthor', t.modificadoPor),
    tag('DueDate', t.prazo ? `${t.prazo}T00:00:00Z` : null),
    tag('AssignedTo', t.responsavel),
    // 2.1 põe Stage antes de Description; 3.0, depois.
    ...(v3 ? [tag('Description', t.descricao), tag('Stage', t.etapa)] : [tag('Stage', t.etapa), tag('Description', t.descricao)]),
  ].join('')
  const comentarios = t.comentarios
    .map(
      (c) =>
        `<Comment Guid="${esc(c.guid)}">${tag('Date', c.data)}${tag('Author', c.autor || AUTOR_DESCONHECIDO)}${tag('Comment', c.texto)}${
          c.viewpointGuid ? `<Viewpoint Guid="${esc(c.viewpointGuid)}"/>` : ''
        }</Comment>`,
    )
    .join('')
  const viewpoints = t.viewpoints
    .map((vp) => {
      const corpo = `${tag('Viewpoint', nomeBcfv(vp))}${vp.snapshot && ehPng(vp.snapshot) ? tag('Snapshot', nomePng(vp)) : ''}`
      return v3 ? `<ViewPoint Guid="${esc(vp.guid)}">${corpo}</ViewPoint>` : `<Viewpoints Guid="${esc(vp.guid)}">${corpo}</Viewpoints>`
    })
    .join('')
  const atributos = `Guid="${esc(t.guid)}"${t.tipo ? ` TopicType="${esc(t.tipo)}"` : ''}${t.status ? ` TopicStatus="${esc(t.status)}"` : ''}`
  if (v3) {
    return `${CABECALHO}<Markup><Topic ${atributos}>${corpoTopico}${comentarios ? `<Comments>${comentarios}</Comments>` : ''}${
      viewpoints ? `<ViewPoints>${viewpoints}</ViewPoints>` : ''
    }</Topic></Markup>\n`
  }
  return `${CABECALHO}<Markup><Topic ${atributos}>${corpoTopico}</Topic>${comentarios}${viewpoints}</Markup>\n`
}

/** Gera o `.bcfzip` do pacote na versão `pacote.versao`. Só snapshots PNG entram no arquivo. */
export function escreverBcf(pacote: PacoteBcf): Uint8Array {
  const v3 = pacote.versao === '3.0'
  const arquivos: Zippable = {
    'bcf.version': strToU8(
      `${CABECALHO}<Version VersionId="${pacote.versao}"><DetailedVersion>${pacote.versao}</DetailedVersion></Version>\n`,
    ),
  }
  if (pacote.projeto) {
    const proj = `<Project ProjectId="${esc(pacote.projeto.id)}">${tag('Name', pacote.projeto.nome)}</Project>`
    arquivos['project.bcfp'] = strToU8(
      `${CABECALHO}${v3 ? `<ProjectInfo>${proj}</ProjectInfo>` : `<ProjectExtension>${proj}<ExtensionSchema></ExtensionSchema></ProjectExtension>`}\n`,
    )
  }
  for (const t of pacote.topicos) {
    arquivos[`${t.guid}/markup.bcf`] = strToU8(xmlMarkup(t, pacote.versao))
    for (const vp of t.viewpoints) {
      arquivos[`${t.guid}/${nomeBcfv(vp)}`] = strToU8(xmlViewpoint(vp))
      if (vp.snapshot && ehPng(vp.snapshot)) arquivos[`${t.guid}/${nomePng(vp)}`] = [vp.snapshot, { level: 0 }]
    }
  }
  return zipSync(arquivos)
}
