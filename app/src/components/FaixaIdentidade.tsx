import { useContext, useState, type ReactNode } from 'react'
import { NOME_APP, OrganizacaoContexto } from './identidade.ts'
import { SeloVersao } from './SeloVersao.tsx'

/**
 * Faixa no alto do topo azul: nome da OM à esquerda, logo da organização militar (se houver) no
 * centro e "Fiscal Bot" à direita. Sem organização carregada ou com o logo indisponível, o lugar
 * fica vazio e os textos continuam nos cantos.
 */
export function FaixaIdentidade() {
  const organizacao = useContext(OrganizacaoContexto)
  const nome = organizacao?.nome.trim() ?? ''
  const logo = organizacao?.logo_url ?? null
  // Logo que não carrega (sem sinal antes de ficar no cache, arquivo removido) some sem aviso.
  const [logoComFalha, setLogoComFalha] = useState<string | null>(null)
  const mostrarLogo = logo !== null && logoComFalha !== logo

  return (
    <div className="identidade" data-testid="faixa-identidade">
      <span className="identidade-om">{nome}</span>
      <span className="identidade-centro">
        {mostrarLogo && (
          // O nome da OM vem ao lado: o logo é decorativo.
          <img className="identidade-logo" src={logo} alt="" height={40} onError={() => setLogoComFalha(logo)} />
        )}
      </span>
      <span className="identidade-app">{NOME_APP}</span>
    </div>
  )
}

/** Topo azul só com a faixa de identidade, para as telas fora do `Layout` (entrada, carregamento). */
export function TopoIdentidade() {
  return (
    <div className="topo">
      <div className="topo-tela topo-identidade">
        <FaixaIdentidade />
        <SeloVersao />
      </div>
    </div>
  )
}

/** Tela fora do `Layout` (entrada, carregamento, erro de sessão): topo de identidade e o conteúdo. */
export function TelaDeEntrada({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={className ? `app-main ${className}` : 'app-main'}>
      <TopoIdentidade />
      {children}
    </main>
  )
}
