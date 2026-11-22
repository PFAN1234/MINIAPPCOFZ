/**
 * Botões e formulário de Importar/Exportar BCF do painel Issues (etapa 7D).
 * Exportar: escolhe a versão (2.1 ou 3.0) e o conjunto (filtro atual ou todas) e baixa o `.bcfzip`.
 * Importar: lê o arquivo, cria/atualiza as issues pelo `guid` e anexa os snapshots.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ReactNode } from 'react'
import { useRepositorioAdmin } from '../../../../admin/dados/contexto.tsx'
import type { MotorVisualizador } from '../../../modelos/application/ports/MotorVisualizador.port.ts'
import type { ObraCentral } from '../../../modelos/domain/tipos.ts'
import { VERSOES_BCF, type VersaoBcf } from '../../domain/bcf.ts'
import type { Issue } from '../../domain/issues.ts'
import {
  exportarIssuesBcf,
  importarArquivoBcf,
  nomeArquivoBcf,
  resumoImportacao,
} from '../../application/use-cases/bcfIssues.ts'
import { ErroBcf, escreverBcf, lerBcf } from '../../infra/bcf/bcfZip.ts'
import { snapshotParaPng } from '../../infra/bcf/imagem.ts'

type Conjunto = 'filtro' | 'todas'
type Mensagem = { tipo: 'ok' | 'erro'; texto: string }

function baixar(dados: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(dados)], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useBcfIssues({
  obra,
  motor,
  pronto,
  issues,
  visiveis,
}: {
  obra: ObraCentral
  motor: MotorVisualizador | null
  pronto: boolean
  /** Todas as issues da obra. */
  issues: Issue[]
  /** As do filtro atual da lista. */
  visiveis: Issue[]
}): { botoes: ReactNode; painel: ReactNode } {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  const entrada = useRef<HTMLInputElement>(null)
  const [aberto, setAberto] = useState(false)
  const [versao, setVersao] = useState<VersaoBcf>('2.1')
  const [conjunto, setConjunto] = useState<Conjunto>('filtro')
  const [ocupado, setOcupado] = useState<'exportando' | 'importando' | null>(null)
  const [mensagem, setMensagem] = useState<Mensagem | null>(null)

  const falhou = (e: unknown, padrao: string) =>
    setMensagem({ tipo: 'erro', texto: e instanceof ErroBcf ? e.message : e instanceof Error && e.message ? e.message : padrao })

  async function exportar() {
    setMensagem(null)
    setOcupado('exportando')
    try {
      const lista = conjunto === 'todas' ? issues : visiveis
      if (lista.length === 0) throw new Error('Não há issues para exportar neste conjunto.')
      const r = await exportarIssuesBcf({
        codec: { escrever: escreverBcf },
        issues: lista,
        versao,
        origemCena: motor?.origemCena(),
        projeto: { id: obra.obra_id, nome: obra.nome },
        baixarImagem: async (caminho) => {
          const url = await repo.urlImagemVista(caminho)
          if (!url) return null
          const resp = await fetch(url)
          return resp.ok ? new Uint8Array(await resp.arrayBuffer()) : null
        },
      })
      baixar(r.dados, nomeArquivoBcf(obra.slug))
      setAberto(false)
      setMensagem({
        tipo: 'ok',
        texto: `${r.topicos} ${r.topicos === 1 ? 'issue exportada' : 'issues exportadas'} em BCF ${versao}${
          r.semImagem ? `; ${r.semImagem} ${r.semImagem === 1 ? 'vista sem snapshot' : 'vistas sem snapshot'}` : ''
        }.`,
      })
    } catch (e) {
      falhou(e, 'Não foi possível exportar o BCF.')
    } finally {
      setOcupado(null)
    }
  }

  async function importar(arquivo: File) {
    setMensagem(null)
    setAberto(false)
    setOcupado('importando')
    try {
      if (!motor) throw new Error('Aguarde os modelos carregarem para importar.')
      const dados = new Uint8Array(await arquivo.arrayBuffer())
      const siglas = (await repo.listarModelos(obra.slug)).map((m) => m.sigla)
      const r = await importarArquivoBcf({
        codec: { ler: lerBcf },
        deps: repo,
        obraId: obra.obra_id,
        dados,
        siglas,
        existem: (refs) => motor.existem(refs),
        paraPng: snapshotParaPng,
        origemCena: motor.origemCena(),
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'issues', obra.obra_id] }),
        qc.invalidateQueries({ queryKey: ['admin', 'central', 'obras'] }),
      ])
      setMensagem({ tipo: 'ok', texto: `Importação concluída: ${resumoImportacao(r)}.` })
    } catch (e) {
      falhou(e, 'Não foi possível importar o BCF.')
    } finally {
      setOcupado(null)
    }
  }

  const botoes = (
    <>
      <button
        type="button"
        className="central-botao"
        disabled={!pronto || ocupado !== null}
        data-dica={pronto ? undefined : 'Aguarde os modelos carregarem'}
        onClick={() => entrada.current?.click()}
      >
        {ocupado === 'importando' ? 'Importando…' : 'Importar BCF'}
      </button>
      <input
        ref={entrada}
        type="file"
        accept=".bcfzip,.bcf,.zip,application/zip"
        hidden
        aria-label="Arquivo BCF"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importar(f)
        }}
      />
      <button
        type="button"
        className="central-botao"
        aria-expanded={aberto}
        disabled={issues.length === 0 || ocupado !== null}
        onClick={() => {
          setMensagem(null)
          setAberto((v) => !v)
        }}
      >
        {ocupado === 'exportando' ? 'Exportando…' : 'Exportar BCF'}
      </button>
    </>
  )

  const painel = (
    <>
      {aberto && (
        <form
          className="central-gestao-form"
          aria-label="Exportar BCF"
          onSubmit={(e) => {
            e.preventDefault()
            void exportar()
          }}
        >
          <label>
            Versão do BCF
            <select value={versao} onChange={(e) => setVersao(e.target.value as VersaoBcf)}>
              {VERSOES_BCF.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {v === '2.1' ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conjunto
            <select value={conjunto} onChange={(e) => setConjunto(e.target.value as Conjunto)}>
              <option value="filtro">Do filtro atual ({visiveis.length})</option>
              <option value="todas">Todas ({issues.length})</option>
            </select>
          </label>
          <div className="central-gestao-acoes">
            <button type="submit" className="central-botao central-botao-principal" disabled={ocupado !== null}>
              Baixar .bcfzip
            </button>
            <button type="button" className="central-botao" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {mensagem &&
        (mensagem.tipo === 'erro' ? (
          <div className="central-gestao-alerta" role="alert">
            <p>{mensagem.texto}</p>
          </div>
        ) : (
          <p className="central-sec" role="status" aria-label="Resultado do BCF">
            {mensagem.texto}
          </p>
        ))}
    </>
  )

  return { botoes, painel }
}
