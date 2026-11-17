/**
 * Edição do boletim emitido (`edicao`, jsonb), como em docs/contrato-boletim.md (parte 4).
 * `aplicarEdicao` é pura: devolve um snapshot novo, sem alterar o recebido. Indicadores e clima
 * não mudam.
 */
import type { FotoSnapshot, Snapshot } from './tipos.js'

export interface Edicao {
  /** Chave (`servico:<id>`, `aberta:<id>`, `encerrada:<id>`, `encerramento:<id>`, `observacao:<obra>:<i>`, `tardio:<id>`) → novo texto. */
  textos?: Record<string, string>
  ocultos?: string[]
  /** Caminhos no bucket `fotos`. */
  fotos_ocultas?: string[]
}

export const LIMITE_TEXTO_EDICAO = 2000
export const LIMITE_ITENS_EDICAO = 500

/** Confere o formato (o mesmo de `privado.validar_edicao`); devolve a edição ou lança com mensagem em pt-BR. */
export function validarEdicao(v: unknown): Edicao {
  const erro = () => new Error('Edição do boletim inválida')
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw erro()
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) if (k !== 'textos' && k !== 'ocultos' && k !== 'fotos_ocultas') throw erro()
  if (o.textos !== undefined) {
    const t = o.textos
    if (typeof t !== 'object' || t === null || Array.isArray(t)) throw erro()
    for (const x of Object.values(t)) if (typeof x !== 'string' || x.length > LIMITE_TEXTO_EDICAO) throw erro()
  }
  for (const k of ['ocultos', 'fotos_ocultas'] as const) {
    const a = o[k]
    if (a === undefined) continue
    if (!Array.isArray(a) || a.length > LIMITE_ITENS_EDICAO || a.some((x) => typeof x !== 'string')) throw erro()
  }
  return o as Edicao
}

export function aplicarEdicao(snapshot: Snapshot, edicao: Edicao): Snapshot {
  const textos = edicao.textos ?? {}
  const ocultos = new Set(edicao.ocultos ?? [])
  const fotosOcultas = new Set(edicao.fotos_ocultas ?? [])
  const tem = (chave: string) => Object.prototype.hasOwnProperty.call(textos, chave)
  const texto = (chave: string, original: string | null): string | null =>
    tem(chave) ? textos[chave]!.trim() || null : original
  const somem = (chave: string) => ocultos.has(chave) || (tem(chave) && textos[chave]!.trim() === '')
  const fotos = (l: FotoSnapshot[]) => l.filter((f) => !fotosOcultas.has(f.path))

  const obras = snapshot.obras.map((obra) => {
    const registros = (prefixo: 'servico' | 'aberta', lista: typeof obra.servicos) =>
      lista
        .filter((r) => !ocultos.has(`${prefixo}:${r.id}`))
        .map((r) => ({ ...r, legenda: texto(`${prefixo}:${r.id}`, r.legenda), fotos: fotos(r.fotos) }))
    const observacoes = obra.observacoes
      .map((o, i) => ({ o, chave: `observacao:${obra.id}:${i}` }))
      .filter(({ chave }) => !somem(chave))
      .map(({ o, chave }) => (tem(chave) ? { ...o, texto: textos[chave]!.trim() } : { ...o }))
    return {
      ...obra,
      servicos: registros('servico', obra.servicos),
      pendencias_abertas: registros('aberta', obra.pendencias_abertas),
      pendencias_encerradas: obra.pendencias_encerradas
        .filter((p) => !ocultos.has(`encerrada:${p.id}`))
        .map((p) => ({
          ...p,
          legenda: texto(`encerrada:${p.id}`, p.legenda),
          fotos_registro: fotos(p.fotos_registro),
          encerramento: {
            ...p.encerramento,
            observacao: texto(`encerramento:${p.id}`, p.encerramento.observacao),
            fotos: fotos(p.encerramento.fotos),
          },
        })),
      observacoes,
    }
  })

  const tardios = snapshot.tardios
    .filter((t) => !somem(`tardio:${t.id}`))
    .map((t) => (tem(`tardio:${t.id}`) ? { ...t, texto: textos[`tardio:${t.id}`]!.trim() } : { ...t }))

  return { ...snapshot, obras, tardios }
}
