/** Barra superior do visualizador: botões ainda desabilitados (ganham função nas próximas etapas). */
const BOTOES = ['Projeção', 'Cor', 'Modelos', 'Issues', 'Medir', 'Cortar', 'Captura', 'Obra']

export default function BarraSuperior() {
  return (
    <div className="central-barra central-barra-superior" role="toolbar" aria-label="Ferramentas do visualizador">
      {BOTOES.map((nome) => (
        <button key={nome} type="button" className="central-botao" aria-label={nome} aria-pressed="false" disabled>
          {nome}
        </button>
      ))}
    </div>
  )
}
