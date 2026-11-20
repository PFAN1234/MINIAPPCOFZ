/** Barra de visibilidade na base do canvas: botões ainda desabilitados. */
const BOTOES = ['Isolar', 'Ocultar', 'Mostrar tudo']

export default function BarraVisibilidade() {
  return (
    <div className="central-barra central-barra-visibilidade" role="toolbar" aria-label="Visibilidade">
      {BOTOES.map((nome) => (
        <button key={nome} type="button" className="central-botao" aria-label={nome} aria-pressed="false" disabled>
          {nome}
        </button>
      ))}
    </div>
  )
}
