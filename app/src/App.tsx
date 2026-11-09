export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Diário da obra</h1>
      </header>
      <main className="app-main">
        <section aria-labelledby="titulo-obras">
          <h2 id="titulo-obras">Obras</h2>
          <div className="estado-vazio">
            <p className="estado-vazio-titulo">Nenhuma obra por aqui ainda</p>
            <p className="estado-vazio-texto">
              A lista das obras que você pode acessar aparecerá aqui.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
