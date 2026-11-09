import { useState } from 'react'
import { Link } from 'react-router'
import { useFila, useFotosLocais } from '../offline/contexto.tsx'
import type { ItemFila } from '../offline/fila.ts'
import { Horario } from './Horario.tsx'
import { VisualizadorFotos } from './VisualizadorFotos.tsx'

/** Texto de estado de um registro que ainda está no aparelho. */
export function textoEstadoLocal(item: ItemFila): string {
  if (item.estado === 'erro') {
    return `Não foi possível enviar: ${item.registro.erro?.mensagem ?? 'erro desconhecido.'}`
  }
  if (item.estado === 'enviando') {
    const p = item.progresso
    if (!p) return 'Enviando…'
    if (p.enviadas >= p.total) return 'Concluindo…'
    return `Enviando fotos ${Math.min(p.enviadas + 1, p.total)} de ${p.total}…`
  }
  return 'Salvo no aparelho · aguardando envio'
}

function MiniaturaLocal({ item }: { item: ItemFila }) {
  const [aberto, setAberto] = useState(false)
  const { registro } = item
  const fotos = registro.fotos
  const urls = useFotosLocais(
    registro.id,
    fotos.map((f) => f.id),
  )
  if (fotos.length === 0) return null
  const url = urls[0]
  const extras = fotos.length - 1
  return (
    <>
      <button
        type="button"
        className="miniatura-registro"
        aria-label={`Abrir ${fotos.length === 1 ? '1 foto' : `${fotos.length} fotos`} do registro`}
        onClick={() => setAberto(true)}
      >
        {url && <img src={url} alt="" />}
        {extras > 0 && (
          <span className="miniatura-extras" aria-hidden="true">
            +{extras}
          </span>
        )}
      </button>
      {aberto && (
        <VisualizadorFotos
          rotulo={`Fotos do registro: ${registro.legenda}`}
          indiceInicial={0}
          onFechar={() => setAberto(false)}
          fotos={fotos.map((f, i) => ({
            id: f.id,
            url: urls[i],
            largura: f.largura,
            altura: f.altura,
          }))}
        />
      )}
    </>
  )
}

/** Item de lista de um registro guardado no aparelho (ainda não enviado). */
export function RegistroLocal({ item, local }: { item: ItemFila; local: boolean }) {
  const { registro, estado } = item
  const { tentarDeNovo, descartar } = useFila()
  const classe = estado === 'erro' ? 'publicacao-problema' : 'publicacao-espera'

  const conteudo = (
    <>
      <span className="registro-topo">
        {registro.tipo === 'servico' ? (
          <span className="selo selo-servico">Serviço</span>
        ) : (
          <span className="selo selo-aberta">Pendência aberta</span>
        )}
        <span className="lista-sub">
          <Horario iso={registro.capturadoEm} />
        </span>
      </span>
      <span className="lista-titulo registro-legenda">{registro.legenda}</span>
      <span className="lista-sub">
        {local ? 'Você' : `${registro.obra.nome} · ${registro.ambiente.nome} · Você`}
      </span>
      <span className={`publicacao ${classe}`}>{textoEstadoLocal(item)}</span>
    </>
  )

  function aoDescartar() {
    if (window.confirm('Descartar este registro? Ele ainda não foi enviado.')) {
      void descartar(registro.id)
    }
  }

  return (
    <li className="registro-item">
      <MiniaturaLocal item={item} />
      <div className="registro-coluna">
        {local ? (
          <div className="lista-item registro-corpo">{conteudo}</div>
        ) : (
          <Link
            className="lista-item registro-corpo"
            to={`/obras/${registro.obra.slug}/ambientes/${registro.ambiente.codigo}`}
          >
            {conteudo}
          </Link>
        )}
        {estado === 'erro' && (
          <div className="registro-acoes">
            <button type="button" className="botao" onClick={() => void tentarDeNovo(registro.id)}>
              Tentar de novo
            </button>
            <button type="button" className="botao botao-secundario" onClick={aoDescartar}>
              Descartar
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
