import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { NavLink, Route, Routes } from 'react-router'
import { Carregando, Erro, IdentidadeOM, mensagemDe } from './componentes.tsx'
import { useRepositorioAdmin } from './dados/contexto.tsx'
import type { Entrada } from './entrada.ts'
import type { EstadoSessao, UsuarioSessao } from './dados/tipos.ts'
import Admins from './telas/Admins.tsx'
import { AcessoNegado, Entrar } from './telas/Entrar.tsx'
import ObraAdmin, { NovaObra } from './telas/ObraAdmin.tsx'
import ObrasAdmin from './telas/ObrasAdmin.tsx'
import Boletins from './telas/boletins/Boletins.tsx'
import EditorBoletim from './telas/boletins/EditorBoletim.tsx'
import EtapaAdmin, { NovaEtapa } from './telas/etapa/EtapaAdmin.tsx'
import Organizacao from './telas/Organizacao.tsx'
import Pessoas from './telas/Pessoas.tsx'
import EditorPlanta from './telas/planta/EditorPlanta.tsx'
import ModelosObra from './telas/modelo/ModelosObra.tsx'
import PlantaObra from './telas/planta/PlantaObra.tsx'
import RaObra from './telas/ra/RaObra.tsx'


interface Sessao {
  estado: EstadoSessao
  erroEntrada: string | null
}

/** Rotas do site (o roteador, com `basename="/admin"`, fica em `main.tsx`). */
export default function AdminApp({ entrada }: { entrada: Entrada }) {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  const sessao = useQuery({
    queryKey: ['admin', 'sessao'],
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<Sessao> => {
      let erroEntrada: string | null = null
      // Lido da URL antes de o React montar; só a primeira leitura recebe o token.
      const token = entrada.pegarToken()
      if (token !== null) {
        try {
          await repo.entrarComToken(token)
        } catch (e) {
          erroEntrada = mensagemDe(e, 'Não foi possível entrar pelo link.')
        }
      }
      return { estado: await repo.estadoSessao(), erroEntrada }
    },
  })

  const reler = () => qc.invalidateQueries({ queryKey: ['admin', 'sessao'] })
  async function sair() {
    await repo.sair()
    qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'admin' && q.queryKey[1] !== 'sessao' })
    await reler()
  }

  if (sessao.isPending) return <Carregando texto="Conferindo a sessão…" />
  if (sessao.isError) {
    return (
      <main className="adm-entrada">
        <Erro erro={sessao.error} onTentar={() => void sessao.refetch()} />
      </main>
    )
  }
  const { estado, erroEntrada } = sessao.data
  if (estado.tipo === 'sem_sessao') return <Entrar erroEntrada={erroEntrada} onEntrou={() => void reler()} />
  if (estado.tipo === 'negado') return <AcessoNegado usuario={estado.usuario} onSair={() => void sair()} />

  return (
    <Layout usuario={estado.usuario} onSair={() => void sair()}>
      <Routes>
        <Route index element={<ObrasAdmin />} />
        <Route path="nova-etapa" element={<NovaEtapa />} />
        <Route path="etapas/:slug" element={<EtapaAdmin />} />
        <Route path="nova-obra" element={<NovaObra />} />
        <Route path="obras/:slug" element={<ObraAdmin />} />
        <Route path="obras/:slug/planta" element={<PlantaObra />} />
        <Route path="obras/:slug/planta/:pavimento" element={<EditorPlanta />} />
        <Route path="obras/:slug/modelos" element={<ModelosObra />} />
        <Route path="boletins" element={<Boletins />} />
        <Route path="boletins/:id" element={<EditorBoletim />} />
        <Route path="pessoas" element={<Pessoas />} />
        <Route path="organizacao" element={<Organizacao />} />
        <Route path="obras/:slug/ra" element={<RaObra />} />
        <Route path="admins" element={<Admins />} />
        <Route path="*" element={<p>Página não encontrada.</p>} />
      </Routes>
    </Layout>
  )
}

function Layout({ usuario, onSair, children }: { usuario: UsuarioSessao; onSair: () => void; children: ReactNode }) {
  return (
    <div className="adm-pagina">
      <header className="adm-topo">
        <IdentidadeOM />
        <nav aria-label="Principal" className="adm-nav">
          <NavLink to="/" end>
            Etapas
          </NavLink>
          <NavLink to="/boletins">Relatórios</NavLink>
          <NavLink to="/pessoas">Pessoas</NavLink>
          <NavLink to="/organizacao">Organização</NavLink>
          <NavLink to="/admins">Admins</NavLink>
        </nav>
        <span className="adm-usuario">{usuario.nome}</span>
        <button type="button" className="adm-botao adm-botao-discreto" onClick={onSair}>
          Sair
        </button>
      </header>
      <main className="adm-conteudo">{children}</main>
    </div>
  )
}
