import { Link } from 'react-router'
import { EstadoVazio } from '../shared/ui/feedback/Estado.tsx'
import { IconeLupa } from '../shared/ui/icones/Icones.tsx'
import { TopoTela } from '../shared/ui/layout/TopoTela.tsx'

/** Endereço que não existe no app (rota `*`). */
export default function NaoEncontrada() {
  return (
    <section aria-labelledby="titulo-nao-encontrada">
      <TopoTela titulo="Página não encontrada" idTitulo="titulo-nao-encontrada" />
      <EstadoVazio
        icone={<IconeLupa tamanho={30} />}
        titulo="Este endereço não existe no app"
        texto="O link pode estar errado ou a tela pode ter mudado de lugar."
        acao={
          <Link className="botao" to="/">
            Voltar ao início
          </Link>
        }
      />
    </section>
  )
}
