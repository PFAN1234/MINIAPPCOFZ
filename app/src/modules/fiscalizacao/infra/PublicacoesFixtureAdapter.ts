import type { PublicacoesRepositorio } from '@modules/fiscalizacao/application/ports/PublicacoesRepositorio.port.ts'
import type { EstadoPublicacao, PublicacaoProblema } from '@modules/fiscalizacao/domain/tipos.ts'
import { ErroEnvio } from '../../../dados/erros.ts'

export interface DepsPublicacoesFixture {
  publicacoesBase: Omit<PublicacaoProblema, 'estado'>[]
  estado: Record<string, EstadoPublicacao>
  obraComDados: string
  exigirGestor: (obraId: string) => void
  exigirRede: () => void
  persistir: () => void
}

export function criarPublicacoesFixture(deps: DepsPublicacoesFixture): PublicacoesRepositorio {
  const { publicacoesBase, estado, obraComDados, exigirGestor, exigirRede, persistir } = deps

  function publicacaoProblema(id: number): PublicacaoProblema {
    const base = publicacoesBase.find((p) => p.id === id)
    if (!base) throw new ErroEnvio('nao_encontrado', 'Publicação não encontrada.')
    return { ...base, estado: estado[String(id)] ?? 'falhou' }
  }

  return {
    async listarPublicacoesProblema(obraId) {
      exigirGestor(obraId)
      return publicacoesBase
        .map((p) => publicacaoProblema(p.id))
        .filter((p) => p.estado === 'incerto' || p.estado === 'falhou')
        .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))
    },

    async republicar(id) {
      exigirRede()
      const p = publicacaoProblema(id)
      exigirGestor(obraComDados)
      if (p.estado !== 'incerto' && p.estado !== 'falhou') {
        throw new ErroEnvio('validacao', 'Só publicações incertas ou com falha podem ser reenviadas.')
      }
      estado[String(id)] = 'pendente'
      persistir()
    },

    async marcarPublicada(id) {
      exigirRede()
      const p = publicacaoProblema(id)
      exigirGestor(obraComDados)
      if (p.estado !== 'incerto' && p.estado !== 'falhou') {
        throw new ErroEnvio('validacao', 'Só publicações incertas ou com falha podem ser marcadas como publicadas.')
      }
      estado[String(id)] = 'publicado'
      persistir()
    },
  }
}
