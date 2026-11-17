import { useState } from 'react'
import type { Etapa, EtapaInicio, ObraDaLista, ObraDisponivel } from '../dados/tipos.ts'
import { compararNatural } from './ordenacao.ts'

/**
 * Etapas da tela inicial: as das obras do usuário e as das "Outras obras" que ele pode pedir,
 * sem repetição, por `ordem` e depois por nome.
 */
export function etapasDasObras(obras: readonly ObraDaLista[], outras: readonly ObraDisponivel[]): Etapa[] {
  const porId = new Map<string, Etapa>()
  // `etapa` pode faltar em dado antigo (cache do aparelho de antes das etapas): a obra fica fora.
  for (const o of obras) if (o.etapa && !porId.has(o.etapa.id)) porId.set(o.etapa.id, o.etapa)
  for (const o of outras) {
    if (!porId.has(o.etapa_id)) {
      porId.set(o.etapa_id, { id: o.etapa_id, slug: '', nome: o.etapa_nome, ordem: o.etapa_ordem })
    }
  }
  return [...porId.values()].sort((a, b) => a.ordem - b.ordem || compararNatural(a.nome, b.nome))
}

/**
 * Abas do Início: todas as etapas ativas (`etapas_inicio`) unidas às das obras em cache e das
 * "Outras obras" (para funcionar sem sinal), por `ordem` e depois por nome.
 */
export function etapasDasAbas(
  inicio: readonly EtapaInicio[],
  obras: readonly ObraDaLista[],
  outras: readonly ObraDisponivel[],
): Etapa[] {
  const porId = new Map<string, Etapa>()
  for (const e of inicio) porId.set(e.id, { id: e.id, slug: e.slug, nome: e.nome, ordem: e.ordem })
  for (const e of etapasDasObras(obras, outras)) if (!porId.has(e.id)) porId.set(e.id, e)
  return [...porId.values()].sort((a, b) => a.ordem - b.ordem || compararNatural(a.nome, b.nome))
}

/** Chave no `localStorage`, por usuário (o aparelho pode ser de mais de uma pessoa). */
export function chaveEtapaGuardada(usuarioId: string): string {
  return `fiscal-bot:etapa:${usuarioId}`
}

/** `localStorage` pode faltar (navegação privada, bloqueio): sem ele, a escolha vale só nesta abertura. */
export function lerEtapaGuardada(usuarioId: string): string | null {
  try {
    return localStorage.getItem(chaveEtapaGuardada(usuarioId))
  } catch {
    return null
  }
}

export function guardarEtapa(usuarioId: string, etapaId: string): void {
  try {
    localStorage.setItem(chaveEtapaGuardada(usuarioId), etapaId)
  } catch {
    // Sem armazenamento: a escolha não sobrevive ao fechar o app.
  }
}

/**
 * Etapa escolhida na tela inicial, lembrada no aparelho. A guardada que não está mais na lista
 * (etapa arquivada, acesso removido) dá lugar à primeira, sem apagar a escolha: ela volta a valer
 * se a etapa reaparecer (por exemplo, quando as "Outras obras" terminam de carregar).
 */
export function useEtapaEscolhida(
  usuarioId: string,
  etapas: readonly Etapa[],
): [Etapa | null, (etapaId: string) => void] {
  const [escolhida, setEscolhida] = useState(() => lerEtapaGuardada(usuarioId))
  const atual = etapas.find((e) => e.id === escolhida) ?? etapas[0] ?? null
  function escolher(etapaId: string) {
    setEscolhida(etapaId)
    guardarEtapa(usuarioId, etapaId)
  }
  return [atual, escolher]
}
