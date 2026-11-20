import type { PapelObra } from '@modules/acessos/domain/tipos.ts'
import type { ObrasRepositorio } from '../application/ports/ObrasRepositorio.port.ts'
import type { Ambiente, DetalhePlanta, ObraDaLista, ObraResumo, Pavimento } from '../domain/tipos.ts'

/** O que a fixture precisa saber de um registro para contar pendências e totais. */
export interface RegistroContagem {
  obra: { id: string }
  ambiente: { id: string }
  tipo: string
  situacao: string | null
}

export interface OpcoesObrasFixture {
  /** Obras da fixture (estado de teste, injetado). */
  obras: readonly ObraDaLista[]
  /** Única obra com pavimentos, ambientes e participação do usuário. */
  obraComDados: string
  pavimentos: readonly Pavimento[]
  ambientes: readonly Omit<Ambiente, 'pendencias_abertas'>[]
  detalhePlanta: (pavimento: string, ambiente: string) => DetalhePlanta | null
  /** Registros atuais (encerramentos aplicados), para os totais. */
  registros: () => readonly RegistroContagem[]
  papelUsuario: () => PapelObra
}

/** Obras da fixture: leitura sobre dados em memória. */
export function criarObrasFixture(o: OpcoesObrasFixture): ObrasRepositorio {
  const { obras, obraComDados, pavimentos, ambientes, detalhePlanta, registros, papelUsuario } = o

  function ambientesComContagem(): Ambiente[] {
    const abertas = new Map<string, number>()
    for (const x of registros()) {
      if (x.tipo === 'pendencia' && x.situacao === 'aberta') {
        abertas.set(x.ambiente.id, (abertas.get(x.ambiente.id) ?? 0) + 1)
      }
    }
    return ambientes.map((a) => ({ ...a, pendencias_abertas: abertas.get(a.id) ?? 0 }))
  }

  function obraPorSlug(slug: string): ObraResumo {
    const obra = obras.find((x) => x.slug === slug)
    if (!obra) throw new Error('Obra não encontrada.')
    return { id: obra.id, slug: obra.slug, nome: obra.nome }
  }

  return {
    async resumoObras() {
      const todos = registros()
      return obras.map((ob) => {
        const dela = todos.filter((x) => x.obra.id === ob.id)
        return {
          obra_id: ob.id,
          // No fixture só a obra com dados tem participação; nas outras o usuário só vê a obra.
          papel: ob.id === obraComDados ? papelUsuario() : null,
          servicos: dela.filter((x) => x.tipo === 'servico').length,
          abertas: dela.filter((x) => x.tipo === 'pendencia' && x.situacao === 'aberta').length,
          resolvidas: dela.filter((x) => x.tipo === 'pendencia' && x.situacao === 'resolvida').length,
        }
      })
    },

    async listarObras() {
      return obras.map((ob) => ({ ...ob, etapa: { ...ob.etapa } }))
    },

    async obterObra(slug) {
      const obra = obraPorSlug(slug)
      if (obra.id !== obraComDados) return { obra, papel: 'equipe', pavimentos: [], ambientes: [] }
      return { obra, papel: papelUsuario(), pavimentos: [...pavimentos], ambientes: ambientesComContagem() }
    },

    async obterAmbiente(slug, codigo) {
      const obra = obraPorSlug(slug)
      const ambiente = ambientesComContagem().find((a) => a.codigo === codigo)
      if (obra.id !== obraComDados || !ambiente) throw new Error('Ambiente não encontrado.')
      const pavimento = pavimentos.find((p) => p.codigo === ambiente.pavimento_codigo)!
      return {
        obra,
        ambiente,
        pavimento,
        planta: pavimento.planta,
        detalhe: detalhePlanta(pavimento.codigo, ambiente.codigo),
      }
    },
  }
}
