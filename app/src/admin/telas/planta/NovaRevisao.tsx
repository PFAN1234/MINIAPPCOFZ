/**
 * Etapa 4: diferenças contra o que está publicado no banco (novos, removidos com sucessor
 * sugerido, códigos mantidos, nome e área alterados, pino deslocado). Confirmar "é o mesmo
 * ambiente" grava `manter_codigo`: o novo herda o código e os registros do antigo.
 */
import { useState } from 'react'
import { decimal, LIMIAR_DESLOCAMENTO, temDiferencas } from '../../planta/extrair.ts'
import type { Diferencas } from '../../planta/tipos.ts'

function area(v: number | null): string {
  return v === null ? 'sem área' : `${v.toLocaleString('pt-BR')} m²`
}

function Removido({
  r,
  novos,
  onConfirmar,
}: {
  r: Diferencas['removidos'][number]
  novos: Diferencas['novos']
  onConfirmar: (idNovo: string, idAntigo: string) => void
}) {
  const [escolhido, setEscolhido] = useState(r.sucessor_sugerido?.id ?? '')
  return (
    <li className="adm-removido">
      <div>
        <strong>{r.nome_operacional}</strong> <code>{r.id}</code> ({area(r.area_m2)}) fica inativo no app; os registros
        dele continuam como histórico.
        {r.sucessor_sugerido ? (
          <span className="adm-dica">
            {' '}
            Provável sucessor: {r.sucessor_sugerido.nome_operacional} ({r.sucessor_sugerido.motivo}).
          </span>
        ) : (
          <span className="adm-dica"> Sem sucessor provável.</span>
        )}
      </div>
      {novos.length > 0 && (
        <div className="adm-acoes">
          <label className="adm-opcao">
            É o mesmo ambiente que
            <select
              aria-label={`Ambiente novo que substitui ${r.nome_operacional}`}
              value={escolhido}
              onChange={(e) => setEscolhido(e.target.value)}
            >
              <option value="">(nenhum: foi removido de verdade)</option>
              {novos.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nome_operacional} ({n.id})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="adm-botao"
            disabled={!escolhido}
            onClick={() => onConfirmar(escolhido, r.id)}
          >
            Confirmar: é o mesmo ambiente
          </button>
        </div>
      )}
    </li>
  )
}

export default function NovaRevisao({
  diferencas,
  primeira,
  totalAmbientes,
  onConfirmar,
  onDesfazer,
}: {
  diferencas: Diferencas
  primeira: boolean
  totalAmbientes: number
  onConfirmar: (idNovo: string, idAntigo: string) => void
  onDesfazer: (idAntigo: string) => void
}) {
  const d = diferencas
  return (
    <section aria-labelledby="titulo-revisao">
      <h2 id="titulo-revisao">Nova revisão</h2>
      {primeira ? (
        <p>Primeira publicação deste pavimento: {totalAmbientes} ambiente(s) entram como novos.</p>
      ) : !temDiferencas(d) ? (
        <p className="adm-alerta adm-alerta-ok">Nenhuma diferença em relação ao que está publicado.</p>
      ) : (
        <p className="adm-dica">
          Diferenças em relação ao que está publicado{d.revisao_base ? ` (${d.revisao_base})` : ''}. Nada é apagado: quem
          sai da planta fica inativo.
        </p>
      )}
      {!primeira && d.novos.length > 0 && (
        <>
          <h3>Novos ({d.novos.length})</h3>
          <ul>
            {d.novos.map((n) => (
              <li key={n.id}>
                {n.nome_operacional} <code>{n.id}</code> ({area(n.area_m2)})
              </li>
            ))}
          </ul>
        </>
      )}
      {d.removidos.length > 0 && (
        <>
          <h3>Removidos ({d.removidos.length})</h3>
          <ul className="adm-lista-limpa">
            {d.removidos.map((r) => (
              <Removido key={r.id} r={r} novos={d.novos} onConfirmar={onConfirmar} />
            ))}
          </ul>
        </>
      )}
      {d.herdados.length > 0 && (
        <>
          <h3>Mesmo ambiente, código mantido ({d.herdados.length})</h3>
          <ul>
            {d.herdados.map((h) => (
              <li key={h.id}>
                {h.nome_antes ?? h.id} → {h.nome_operacional} <code>{h.id}</code>
                {h.reativado && ' (volta a ficar ativo)'}{' '}
                <button type="button" className="adm-botao adm-botao-discreto adm-botao-mini" onClick={() => onDesfazer(h.id)}>
                  Desfazer
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.nome_alterado.length > 0 && (
        <>
          <h3>Nome alterado, mesmo código ({d.nome_alterado.length})</h3>
          <ul>
            {d.nome_alterado.map((n) => (
              <li key={n.id}>
                {n.antes} → {n.depois} <code>{n.id}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.area_alterada.length > 0 && (
        <>
          <h3>Área alterada ({d.area_alterada.length})</h3>
          <ul>
            {d.area_alterada.map((n) => (
              <li key={n.id}>
                {n.nome_operacional}: {area(n.antes)} → {area(n.depois)}
              </li>
            ))}
          </ul>
        </>
      )}
      {d.marcador_deslocado.length > 0 && (
        <>
          <h3>
            Pino deslocado mais de {decimal(LIMIAR_DESLOCAMENTO)} ({d.marcador_deslocado.length})
          </h3>
          <ul>
            {d.marcador_deslocado.map((n) => (
              <li key={n.id}>
                {n.nome_operacional}: {n.distancia === null ? 'quantidade de pinos diferente' : decimal(n.distancia)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
