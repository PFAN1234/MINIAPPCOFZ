import { useId, useMemo, useState } from 'react'
import { useUrlsImagens } from '../dados/hooks.ts'
import type { ObraDetalhe } from '../dados/tipos.ts'
import { filtrarAmbientes } from '../util/busca.ts'
import { ordenarNatural } from '../util/ordenacao.ts'
import { EstadoVazio } from './Estado.tsx'
import { PlantaViewer, type MarcadorPlanta } from './PlantaViewer.tsx'

interface Props {
  obra: ObraDetalhe
  pavimentoCodigo: string
  focoCodigo: string | null
  onFocoChange(codigo: string | null): void
  onSelecionarAmbiente(codigo: string): void
}

const MAX_SUGESTOES = 8

export function AbaPlanta({
  obra,
  pavimentoCodigo,
  focoCodigo,
  onFocoChange,
  onSelecionarAmbiente,
}: Props) {
  const [busca, setBusca] = useState('')
  const idLista = useId()
  const pavimento = obra.pavimentos.find((p) => p.codigo === pavimentoCodigo)
  const planta = pavimento?.planta ?? null
  const paths = planta ? [planta.imagem.path, ...(planta.imagem_hd ? [planta.imagem_hd.path] : [])] : []
  const urls = useUrlsImagens(paths)

  const doPavimento = useMemo(
    () => obra.ambientes.filter((a) => a.ativo && a.pavimento_codigo === pavimentoCodigo),
    [obra.ambientes, pavimentoCodigo],
  )
  const marcadores = useMemo<MarcadorPlanta[]>(
    () =>
      doPavimento.flatMap((a) =>
        a.marcadores.map((m) => ({
          codigo: a.codigo,
          nome: a.nome_operacional,
          x: m.x,
          y: m.y,
          pendencias: a.pendencias_abertas,
        })),
      ),
    [doPavimento],
  )
  const sugestoes = useMemo(
    () =>
      busca.trim()
        ? ordenarNatural(filtrarAmbientes(doPavimento, busca), (a) => a.nome_operacional).slice(
            0,
            MAX_SUGESTOES,
          )
        : [],
    [doPavimento, busca],
  )

  if (!planta) {
    return <EstadoVazio titulo="Planta ainda não publicada" />
  }

  const focoAmbiente = doPavimento.find((a) => a.codigo === focoCodigo)
  const urlBase = urls.data?.[planta.imagem.path]
  const urlHd = planta.imagem_hd ? urls.data?.[planta.imagem_hd.path] : undefined

  return (
    <div className="aba-planta">
      <div className="planta-busca">
        <input
          type="search"
          className="planta-busca-campo"
          placeholder="Buscar ambiente na planta"
          aria-label="Buscar ambiente na planta"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-controls={idLista}
        />
        {sugestoes.length > 0 && (
          <ul className="planta-sugestoes" id={idLista}>
            {sugestoes.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="planta-sugestao"
                  onClick={() => {
                    setBusca('')
                    onFocoChange(a.codigo)
                  }}
                >
                  {a.nome_operacional}
                </button>
              </li>
            ))}
          </ul>
        )}
        {busca.trim() && sugestoes.length === 0 && (
          <p className="planta-sem-resultado">Nenhum ambiente encontrado</p>
        )}
      </div>

      {focoAmbiente && (
        <p className="planta-foco" aria-live="polite">
          <strong>{focoAmbiente.nome_operacional}</strong>
          <button
            type="button"
            className="planta-foco-limpar"
            aria-label="Limpar seleção"
            onClick={() => onFocoChange(null)}
          >
            ×
          </button>
        </p>
      )}

      <div className="planta-area">
        {urlBase ? (
          <PlantaViewer
            imagem={{
              url: urlBase,
              largura: planta.imagem.largura,
              altura: planta.imagem.altura,
              recorte_pt: planta.recorte_pt,
              pagina_pt: planta.pagina_pt,
            }}
            imagemHd={urlHd ? { url: urlHd } : undefined}
            marcadores={marcadores}
            focoCodigo={focoCodigo}
            onSelecionar={onSelecionarAmbiente}
          />
        ) : (
          <p className="estado-texto" role="status">
            Carregando planta…
          </p>
        )}
      </div>

      <p className="planta-aviso">Planta de arquitetura {planta.revisao} · posição indicativa</p>
    </div>
  )
}
