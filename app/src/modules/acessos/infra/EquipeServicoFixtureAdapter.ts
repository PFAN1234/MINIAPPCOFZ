import { ErroEnvio } from '../../../dados/erros.ts'
import type { EquipeServicoRepositorio } from '../application/ports/EquipeServicoRepositorio.port.ts'
import type { EquipeServico, MembroServico } from '../domain/tipos.ts'

export interface OpcoesEquipeServicoFixture {
  /** Etapas conhecidas (estado de outro contexto). */
  etapas: { id: string; nome: string }[]
  /** Etapa em que o usuário de teste não participa (e que já tem um colega de serviço). */
  etapaSemParticipacao: string
  exigirRede: () => void
}

/** Equipe de serviço: só em memória. */
export function criarEquipeServicoFixture(o: OpcoesEquipeServicoFixture): EquipeServicoRepositorio {
  const { etapas, etapaSemParticipacao, exigirRede } = o
  let servicos: (MembroServico & { etapa_id: string })[] = [
    {
      id: 'servico-colega',
      etapa_id: etapaSemParticipacao,
      usuario_id: 'usuario-colega',
      nome: 'SD COLEGA',
      entrada_em: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      saida_em: null,
      saida_automatica: false,
      eu: false,
    },
  ]
  let proximoServico = 1

  function equipeDaEtapa(etapaId: string): EquipeServico {
    const etapa = etapas.find((e) => e.id === etapaId)
    if (!etapa) throw new ErroEnvio('nao_encontrado', 'Etapa não encontrada')
    const aberto = servicos.find((s) => s.eu && s.saida_em === null)
    const etapaAberto = aberto && etapas.find((e) => e.id === aberto.etapa_id)
    return {
      etapa_id: etapa.id,
      participa: etapa.id !== etapaSemParticipacao,
      tem_localizacao: true,
      meu_servico:
        aberto && etapaAberto
          ? { id: aberto.id, etapa_id: aberto.etapa_id, etapa_nome: etapaAberto.nome, entrada_em: aberto.entrada_em }
          : null,
      equipe: servicos
        .filter((s) => s.etapa_id === etapa.id)
        .sort((a, b) => Number(b.saida_em === null) - Number(a.saida_em === null) || b.entrada_em.localeCompare(a.entrada_em))
        .map((s) => ({
          id: s.id,
          usuario_id: s.usuario_id,
          nome: s.nome,
          entrada_em: s.entrada_em,
          saida_em: s.saida_em,
          saida_automatica: s.saida_automatica,
          eu: s.eu,
        })),
    }
  }

  return {
    async equipeServico(etapaId) {
      return equipeDaEtapa(etapaId)
    },

    async fazerCheckin(etapaId) {
      exigirRede()
      const atual = equipeDaEtapa(etapaId)
      if (!atual.participa) throw new ErroEnvio('permissao', 'Você não participa desta etapa')
      if (atual.meu_servico) {
        throw new ErroEnvio('conflito', `Você já está de serviço na ${atual.meu_servico.etapa_nome}`)
      }
      servicos = [
        ...servicos,
        {
          id: `servico-${proximoServico++}`,
          etapa_id: etapaId,
          usuario_id: 'usuario-teste',
          nome: 'CP TESTE',
          entrada_em: new Date().toISOString(),
          saida_em: null,
          saida_automatica: false,
          eu: true,
        },
      ]
      return equipeDaEtapa(etapaId)
    },

    async fazerCheckout() {
      exigirRede()
      const aberto = servicos.find((s) => s.eu && s.saida_em === null)
      if (!aberto) throw new ErroEnvio('nao_encontrado', 'Você não está de serviço')
      servicos = servicos.map((s) => (s === aberto ? { ...s, saida_em: new Date().toISOString() } : s))
      return equipeDaEtapa(aberto.etapa_id)
    },
  }
}
