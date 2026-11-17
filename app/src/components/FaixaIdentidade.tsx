import { useContext, useState, type ReactNode } from 'react'
import { NOME_APP, OrganizacaoContexto } from './identidade.ts'
import { SeloVersao } from './SeloVersao.tsx'

/**
 * Assinatura do topo azul, à esquerda: brasão da organização militar (se houver), com o nome da
 * OM e "Fiscal Bot" ao lado. Sem organização carregada ou com o logo indisponível, ficam só os textos.
 */
export function MarcaOM() {
  const organizacao = useContext(OrganizacaoContexto)
  const nome = organizacao?.nome.trim() ?? ''
  const logo = organizacao?.logo_url ?? null
  // Logo que não carrega (sem sinal antes de ficar no cache, arquivo removido) some sem aviso.
  const [logoComFalha, setLogoComFalha] = useState<string | null>(null)
  const mostrarLogo = logo !== null && logoComFalha !== logo

  return (
    <div className="marca" data-testid="faixa-identidade">
      {mostrarLogo && (
        // O nome da OM vem ao lado: o logo é decorativo.
        <img className="marca-logo" src={logo} alt="" height={52} onError={() => setLogoComFalha(logo)} />
      )}
      <span className="marca-textos">
        {nome && <span className="marca-om">{nome}</span>}
        <span className="marca-app">{NOME_APP}</span>
      </span>
    </div>
  )
}

/** Topo azul só com a assinatura e a versão, para as telas fora do `Layout` (entrada, carregamento). */
export function TopoIdentidade() {
  return (
    <div className="topo">
      <div className="topo-tela topo-identidade">
        <div className="topo-faixa">
          <MarcaOM />
          <SeloVersao />
        </div>
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
