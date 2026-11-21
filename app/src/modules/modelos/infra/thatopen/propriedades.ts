/**
 * Transforma os dados brutos de `FragmentsModel.getItemsData` em grupos de propriedades para a
 * tela. Função pura, sem three nem That Open (tipos estruturais próprios), para ser testável.
 */
import type { GrupoPropriedades } from '../../domain/central.ts'

export interface AtributoBruto {
  value?: unknown
  type?: string
}
export interface DadosBrutos {
  [nome: string]: AtributoBruto | DadosBrutos[] | undefined
}

/** Relações pedidas ao `getItemsData` (nomes IFC). */
export const RELACOES_PROPRIEDADES = {
  IsDefinedBy: { attributes: true, relations: true },
  IsTypedBy: { attributes: true, relations: false },
  HasAssociations: { attributes: true, relations: false },
  ContainedInStructure: { attributes: true, relations: false },
}

const QUANTIDADES = ['LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue']

const ehLista = (v: unknown): v is DadosBrutos[] => Array.isArray(v)
const ehAtributo = (v: unknown): v is AtributoBruto => typeof v === 'object' && v !== null && !Array.isArray(v)

function texto(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4).replace('.', ',')
  if (typeof v === 'object') {
    const interno = (v as { value?: unknown }).value
    return interno === undefined ? '' : texto(interno)
  }
  return String(v)
}

function valorDe(d: DadosBrutos | undefined, nome: string): string {
  const a = d?.[nome]
  return ehAtributo(a) ? texto(a.value) : ''
}
function categoriaDe(d: DadosBrutos): string {
  return valorDe(d, '_category').toUpperCase()
}
function filhos(d: DadosBrutos, nome: string): DadosBrutos[] {
  const l = d[nome]
  return ehLista(l) ? l : []
}

/** Atributos diretos: valores simples (sem metadado interno `_x`), mais classe e GlobalId. */
function grupoAtributos(d: DadosBrutos): GrupoPropriedades {
  const itens: { nome: string; valor: string }[] = []
  const classe = valorDe(d, '_category')
  if (classe) itens.push({ nome: 'Classe', valor: classe })
  const guid = valorDe(d, '_guid') || valorDe(d, 'GlobalId')
  if (guid) itens.push({ nome: 'GlobalId', valor: guid })
  for (const [nome, a] of Object.entries(d)) {
    if (nome.startsWith('_') || nome === 'GlobalId' || !ehAtributo(a)) continue
    const valor = texto(a.value)
    if (valor) itens.push({ nome, valor })
  }
  return { nome: 'Atributos', itens }
}

function grupoPset(p: DadosBrutos): GrupoPropriedades | null {
  const nome = valorDe(p, 'Name') || 'Conjunto'
  const itens: { nome: string; valor: string }[] = []
  for (const prop of filhos(p, 'HasProperties')) {
    const n = valorDe(prop, 'Name')
    const v = valorDe(prop, 'NominalValue')
    if (n && v) itens.push({ nome: n, valor: v })
  }
  return itens.length ? { nome, itens } : null
}

function grupoQuantidades(q: DadosBrutos): GrupoPropriedades | null {
  const nome = valorDe(q, 'Name') || 'Quantidades'
  const itens: { nome: string; valor: string }[] = []
  for (const item of filhos(q, 'Quantities')) {
    const n = valorDe(item, 'Name')
    const campo = QUANTIDADES.find((c) => valorDe(item, c) !== '')
    if (n && campo) itens.push({ nome: n, valor: valorDe(item, campo) })
  }
  return itens.length ? { nome, itens, quantidades: true } : null
}

function nomesDe(d: DadosBrutos, relacao: string, aceita: (cat: string) => boolean): string[] {
  const nomes: string[] = []
  for (const r of filhos(d, relacao)) {
    if (!aceita(categoriaDe(r))) continue
    const n = valorDe(r, 'Name')
    if (n) nomes.push(n)
  }
  return nomes
}

/** Converte os dados brutos de um item nos grupos exibidos na inspeção. */
export function gruposDeDados(d: DadosBrutos): GrupoPropriedades[] {
  const grupos: GrupoPropriedades[] = [grupoAtributos(d)]
  const quantidades: GrupoPropriedades[] = []
  for (const def of filhos(d, 'IsDefinedBy')) {
    const cat = categoriaDe(def)
    if (cat === 'IFCELEMENTQUANTITY') {
      const g = grupoQuantidades(def)
      if (g) quantidades.push(g)
    } else if (cat === 'IFCPROPERTYSET' || cat === '') {
      const g = grupoPset(def)
      if (g) grupos.push(g)
    }
  }
  grupos.push(...quantidades)

  const tipos = filhos(d, 'IsTypedBy')
    .map((t) => ({ nome: valorDe(t, 'Name'), classe: valorDe(t, '_category') }))
    .filter((t) => t.nome)
  if (tipos.length) {
    grupos.push({
      nome: 'Tipo',
      itens: tipos.flatMap((t) => [
        { nome: 'Nome', valor: t.nome },
        ...(t.classe ? [{ nome: 'Classe', valor: t.classe }] : []),
      ]),
    })
  }

  const materiais = nomesDe(d, 'HasAssociations', (c) => c.startsWith('IFCMATERIAL'))
  if (materiais.length) grupos.push({ nome: 'Material', itens: materiais.map((m) => ({ nome: 'Material', valor: m })) })

  const pavimentos = nomesDe(d, 'ContainedInStructure', () => true)
  if (pavimentos.length) grupos.push({ nome: 'Localização', itens: pavimentos.map((p) => ({ nome: 'Pavimento', valor: p })) })
  return grupos
}
