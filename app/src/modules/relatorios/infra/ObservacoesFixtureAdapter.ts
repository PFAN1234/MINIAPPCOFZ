import type { ObservacoesRepositorio } from '@modules/relatorios/application/ports/ObservacoesRepositorio.port.ts'
import type { NovaObservacao, Observacao, ObservacoesDoDia } from '@modules/relatorios/domain/tipos.ts'
import { dataNoFuso, formatarDia } from '@shared/kernel/fuso.ts'
import { ErroEnvio } from '../../../dados/erros.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MENSAGEM_SO_AUTOR = 'Só o autor pode alterar a observação'

/** Observação guardada no "servidor" da fixture. */
export interface ObservacaoSalva {
  id: string
  obraId: string
  autorId: string
  autorNome: string
  data: string
  texto: string
  escrito_em: string
  editado_em: string | null
}

export interface DepsObservacoesFixture {
  observacoes: ObservacaoSalva[]
  fuso: string
  boletimEmitido: boolean
  idUsuario: string
  autorFixture: string
  obrasIds: string[]
  exigirRede: () => void
  persistir: () => void
}

function falhaValidacao(msg: string): never {
  throw new ErroEnvio('validacao', msg)
}

export function criarObservacoesFixture(deps: DepsObservacoesFixture): ObservacoesRepositorio {
  const { observacoes, fuso, boletimEmitido, idUsuario, autorFixture, obrasIds, exigirRede, persistir } = deps
  const hoje = () => dataNoFuso(new Date(), fuso)
  /** Como `privado.boletim_emitido`: só o dia de hoje pode estar emitido na fixture. */
  const diaTravado = (data: string) => boletimEmitido && data === hoje()

  function exigirDiaAberto(data: string): void {
    if (diaTravado(data)) {
      falhaValidacao(`O boletim de ${formatarDia(data)} já foi emitido; a correção é feita por retificação`)
    }
  }

  function exigirObra(obraId: string): void {
    if (!obrasIds.includes(obraId)) {
      throw new ErroEnvio('permissao', 'Sem permissão nesta obra')
    }
  }

  function observacaoPublica(o: ObservacaoSalva): Observacao {
    return {
      id: o.id,
      data: o.data,
      texto: o.texto,
      escrito_em: o.escrito_em,
      editado_em: o.editado_em,
      autor: { id: o.autorId, nome: o.autorNome },
      minha: o.autorId === idUsuario,
      travada: diaTravado(o.data),
    }
  }

  return {
    async observacoesDoDia(obraId): Promise<ObservacoesDoDia> {
      exigirObra(obraId)
      const data = hoje()
      return {
        data,
        fuso,
        travada: diaTravado(data),
        observacoes: observacoes
          .filter((o) => o.obraId === obraId && o.data === data)
          .sort((a, b) => a.escrito_em.localeCompare(b.escrito_em) || a.id.localeCompare(b.id))
          .map(observacaoPublica),
      }
    },

    async salvarObservacao(d: NovaObservacao) {
      exigirRede()
      if (typeof d.id !== 'string' || !UUID.test(d.id)) falhaValidacao('Identificador da observação inválido')
      const texto = String(d.texto ?? '').replace(/^\s+|\s+$/g, '')
      if (texto.length < 1 || texto.length > 1000) {
        falhaValidacao('A observação deve ter de 1 a 1000 caracteres')
      }
      const existente = observacoes.find((o) => o.id === d.id)
      if (!existente) {
        exigirObra(d.obraId)
        const escrito = Date.parse(d.escritoEm)
        if (Number.isNaN(escrito)) falhaValidacao('Data e hora da observação inválidas')
        if (escrito > Date.now() + 5 * 60_000) {
          falhaValidacao('A hora da observação está no futuro; confira o relógio do aparelho')
        }
        const data = dataNoFuso(new Date(escrito), fuso)
        exigirDiaAberto(data)
        const nova: ObservacaoSalva = {
          id: d.id,
          obraId: d.obraId,
          autorId: idUsuario,
          autorNome: autorFixture,
          data,
          texto,
          escrito_em: new Date(escrito).toISOString(),
          editado_em: null,
        }
        observacoes.push(nova)
        persistir()
        return observacaoPublica(nova)
      }
      if (existente.autorId !== idUsuario) throw new ErroEnvio('permissao', MENSAGEM_SO_AUTOR)
      if (existente.texto === texto) return observacaoPublica(existente) // reenvio idempotente
      exigirDiaAberto(existente.data)
      existente.texto = texto
      existente.editado_em = new Date().toISOString()
      persistir()
      return observacaoPublica(existente)
    },

    async excluirObservacao(id) {
      exigirRede()
      const i = observacoes.findIndex((o) => o.id === id)
      if (i < 0) return
      if (observacoes[i].autorId !== idUsuario) throw new ErroEnvio('permissao', MENSAGEM_SO_AUTOR)
      exigirDiaAberto(observacoes[i].data)
      observacoes.splice(i, 1)
      persistir()
    },
  }
}
