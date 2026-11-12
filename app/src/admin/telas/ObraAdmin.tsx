import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ComDados, mensagemDe, Resultado, SelectCategoria } from '../componentes.tsx'
import { Historico } from './planta/PlantaObra.tsx'
import ArquivarExcluir, { AvisoArquivada } from './obra/ArquivarExcluir.tsx'
import {
  useEtapas,
  useExportarObra,
  useObraAdmin,
  useSalvarConfig,
  useSalvarObra,
  useSalvarPavimentos,
} from '../dados/hooks.ts'
import {
  ROTULO_STATUS,
  type ConfigObra,
  type EtapaLista,
  type ObraAdmin as DadosObraAdmin,
  type PavimentoAdmin,
  type StatusObra,
} from '../dados/tipos.ts'

const SLUG = /^[a-z0-9-]+$/

type Secao = 'obra' | 'pavimentos' | 'config'

/** Tela de uma obra: dados, pavimentos, configuração e exportação. */
export default function ObraAdmin() {
  const { slug = '' } = useParams()
  const consulta = useObraAdmin(slug)
  // Mensagens de sucesso ficam aqui: as seções são recriadas quando os dados voltam do servidor.
  const [salvo, setSalvo] = useState<{ secao: Secao; texto: string } | null>(null)
  const sucesso = (s: Secao) => (salvo?.secao === s ? salvo.texto : null)

  return (
    <ComDados consulta={consulta}>
      {(d) => (
        <article aria-labelledby="titulo-obra">
          <p>
            <Link to="/">← Etapas</Link>
          </p>
          <h1 id="titulo-obra">{d.obra.nome}</h1>
          {d.obra.etapa && (
            <p className="adm-etapa-da-obra">
              Etapa: <Link to={`/etapas/${d.obra.etapa.slug}`}>{d.obra.etapa.nome}</Link>
            </p>
          )}
          {d.obra.etapa?.arquivada_em && (
            <p className="adm-alerta adm-alerta-aviso" role="status">
              A etapa {d.obra.etapa.nome} está arquivada (desde{' '}
              {new Date(d.obra.etapa.arquivada_em).toLocaleString('pt-BR')}): esta obra não aparece no Mini App e nada é
              publicado no Telegram enquanto a etapa estiver arquivada, mesmo com a obra ativa. Desarquive na{' '}
              <Link to={`/etapas/${d.obra.etapa.slug}`}>página da etapa</Link> ou mude a obra de etapa.
            </p>
          )}
          {d.obra.arquivada_em && <AvisoArquivada arquivadaEm={d.obra.arquivada_em} />}
          <DadosDaObra
            key={`${d.obra.nome}|${d.obra.ordem}|${d.obra.etapa?.id ?? ''}`}
            obra={d.obra}
            sucesso={sucesso('obra')}
            onSalvo={() => setSalvo({ secao: 'obra', texto: 'Obra salva.' })}
          />
          <Pavimentos
            key={JSON.stringify(d.pavimentos)}
            slug={d.obra.slug}
            pavimentos={d.pavimentos}
            sucesso={sucesso('pavimentos')}
            onSalvo={() => setSalvo({ secao: 'pavimentos', texto: 'Pavimentos salvos.' })}
          />
          <Configuracao
            key={d.config_atualizada_em ?? 'sem-config'}
            dados={d}
            sucesso={sucesso('config')}
            onSalvo={() => setSalvo({ secao: 'config', texto: 'Configuração salva.' })}
          />
          <Planta slug={d.obra.slug} pavimentos={d.pavimentos} />
          <Historico slug={d.obra.slug} />
          <Modelo3d slug={d.obra.slug} />
          <RealidadeAumentada slug={d.obra.slug} />
          <Exportar slug={d.obra.slug} />
          <ArquivarExcluir obra={d.obra} />
        </article>
      )}
    </ComDados>
  )
}

function inteiro(texto: string): number | null {
  return /^-?\d{1,9}$/.test(texto.trim()) ? Number(texto) : null
}

// --- Nova obra -------------------------------------------------------------------------------

/** Select das etapas (ativas; a atual entra mesmo arquivada). */
function SelectEtapa({
  etapas,
  valor,
  atual,
  onMudar,
  descricao,
}: {
  etapas: EtapaLista[]
  valor: string
  atual?: string
  onMudar: (id: string) => void
  descricao?: string
}) {
  const opcoes = etapas.filter((e) => !e.arquivada_em || e.id === atual)
  return (
    <select value={valor} onChange={(e) => onMudar(e.target.value)} required aria-describedby={descricao}>
      {!valor && <option value="">Escolha a etapa…</option>}
      {opcoes.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nome}
          {e.arquivada_em ? ' (arquivada)' : ''}
        </option>
      ))}
    </select>
  )
}

export function NovaObra() {
  const etapas = useEtapas()
  return <ComDados consulta={etapas}>{(lista) => <FormNovaObra etapas={lista} />}</ComDados>
}

function FormNovaObra({ etapas }: { etapas: EtapaLista[] }) {
  const salvar = useSalvarObra()
  const navegar = useNavigate()
  const [busca] = useSearchParams()
  const ativas = etapas.filter((e) => !e.arquivada_em)
  const pedida = ativas.find((e) => e.slug === busca.get('etapa'))
  const [etapaId, setEtapaId] = useState(pedida?.id ?? (ativas.length === 1 ? ativas[0].id : ''))
  const [slug, setSlug] = useState('')
  const [nome, setNome] = useState('')
  const [ordem, setOrdem] = useState('0')
  const [aviso, setAviso] = useState<string | null>(null)

  function enviar(e: FormEvent) {
    e.preventDefault()
    const n = inteiro(ordem)
    if (!etapaId) return setAviso('Escolha a etapa da obra.')
    if (!SLUG.test(slug)) return setAviso('Slug inválido: use letras minúsculas, dígitos e hífen.')
    if (!nome.trim()) return setAviso('Informe o nome da obra.')
    if (n === null) return setAviso('A ordem precisa ser um número inteiro.')
    setAviso(null)
    salvar.mutate(
      { slug, nome: nome.trim(), ordem: n, etapa_id: etapaId },
      { onSuccess: (o) => navegar(`/obras/${o.slug}`) },
    )
  }

  const voltar = ativas.find((e) => e.id === etapaId)
  return (
    <section aria-labelledby="titulo-nova">
      <p>
        {voltar ? <Link to={`/etapas/${voltar.slug}`}>← {voltar.nome}</Link> : <Link to="/">← Etapas</Link>}
      </p>
      <h1 id="titulo-nova">Nova obra</h1>
      {ativas.length === 0 ? (
        <p className="adm-alerta adm-alerta-aviso" role="status">
          Não há etapa ativa. <Link to="/nova-etapa">Crie uma etapa</Link> antes de cadastrar a obra.
        </p>
      ) : (
        <form className="adm-form" onSubmit={enviar}>
          <label>
            Etapa
            <SelectEtapa etapas={etapas} valor={etapaId} onMudar={setEtapaId} />
          </label>
          <label>
            Slug
            <input value={slug} onChange={(e) => setSlug(e.target.value.trim())} placeholder="ex.: cofz" required />
            <span className="adm-dica">Letras minúsculas, dígitos e hífen. Não muda depois de criado.</span>
          </label>
          <label>
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} required />
          </label>
          <label>
            Ordem
            <input value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" />
          </label>
          <Resultado sucesso={null} erro={aviso ? new Error(aviso) : salvar.error} />
          <div>
            <button type="submit" className="adm-botao adm-botao-principal" disabled={salvar.isPending}>
              Criar obra
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

// --- Dados da obra ---------------------------------------------------------------------------

interface PropsSecao {
  sucesso: string | null
  onSalvo: () => void
}

function DadosDaObra({ obra, sucesso, onSalvo }: PropsSecao & { obra: DadosObraAdmin['obra'] }) {
  const salvar = useSalvarObra()
  const etapas = useEtapas()
  const idDica = useId()
  const [nome, setNome] = useState(obra.nome)
  const [ordem, setOrdem] = useState(String(obra.ordem))
  const [etapaId, setEtapaId] = useState(obra.etapa?.id ?? '')
  const [aviso, setAviso] = useState<string | null>(null)
  const destino = etapas.data?.find((e) => e.id === etapaId)
  const mudaEtapa = !!obra.etapa && etapaId !== '' && etapaId !== obra.etapa.id

  function enviar(e: FormEvent) {
    e.preventDefault()
    const n = inteiro(ordem)
    if (!nome.trim()) return setAviso('Informe o nome da obra.')
    if (n === null) return setAviso('A ordem precisa ser um número inteiro.')
    setAviso(null)
    // `etapa_id` só vai quando muda: é o que move a obra de etapa.
    salvar.mutate(
      { id: obra.id, nome: nome.trim(), ordem: n, ...(mudaEtapa ? { etapa_id: etapaId } : {}) },
      { onSuccess: onSalvo },
    )
  }

  return (
    <section className="adm-secao" aria-labelledby="titulo-dados">
      <h2 id="titulo-dados">Dados da obra</h2>
      <form className="adm-form" onSubmit={enviar}>
        <label>
          Slug
          <input value={obra.slug} readOnly disabled />
        </label>
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <label>
          Ordem
          <input value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" />
        </label>
        {obra.etapa && etapas.data && (
          <div className="adm-campo-com-dica">
            <label>
              Etapa
              <SelectEtapa
                etapas={etapas.data}
                valor={etapaId}
                atual={obra.etapa.id}
                onMudar={setEtapaId}
                descricao={idDica}
              />
            </label>
            <span className="adm-dica" id={idDica}>
              Mudar de etapa move a obra para a lista da outra etapa. Se o grupo do Telegram da outra etapa for
              diferente, o vínculo da obra com o tópico é apagado (vincule de novo com /vincular_obra {obra.slug}).
            </span>
          </div>
        )}
        {mudaEtapa && destino && (
          <p className="adm-alerta adm-alerta-aviso" role="status">
            Ao salvar, a obra passa para a etapa {destino.nome}.
            {destino.arquivada_em ? ' Essa etapa está arquivada.' : ''}
          </p>
        )}
        <p className="adm-dica">
          Tópico do Telegram:{' '}
          {obra.telegram_vinculado
            ? 'vinculado'
            : obra.etapa && !obra.etapa.telegram_vinculado
              ? `não vinculado. Vincule antes o grupo da etapa (/vincular_etapa ${obra.etapa.slug}) e depois use /vincular_obra ${obra.slug} no tópico.`
              : `não vinculado (use /vincular_obra ${obra.slug} no tópico do grupo da etapa).`}
        </p>
        <Resultado sucesso={sucesso} erro={aviso ? new Error(aviso) : salvar.error} />
        <div>
          <button type="submit" className="adm-botao adm-botao-principal" disabled={salvar.isPending}>
            Salvar obra
          </button>
        </div>
      </form>
    </section>
  )
}

// --- Pavimentos ------------------------------------------------------------------------------

interface LinhaPavimento {
  chave: number
  codigo: string
  nome: string
  ordem: string
  novo: boolean
  ambientes: number
  plantas: number
}

function Pavimentos({ slug, pavimentos, sucesso, onSalvo }: PropsSecao & { slug: string; pavimentos: PavimentoAdmin[] }) {
  const salvar = useSalvarPavimentos(slug)
  const [linhas, setLinhas] = useState<LinhaPavimento[]>(() =>
    pavimentos.map((p, i) => ({
      chave: i,
      codigo: p.codigo,
      nome: p.nome,
      ordem: String(p.ordem),
      novo: false,
      ambientes: p.ambientes,
      plantas: p.plantas,
    })),
  )
  const [aviso, setAviso] = useState<string | null>(null)

  const mudar = (chave: number, campo: 'codigo' | 'nome' | 'ordem', valor: string) =>
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)))

  function incluir() {
    setLinhas((ls) => {
      const maior = ls.reduce((m, l) => Math.max(m, inteiro(l.ordem) ?? 0), 0)
      const chave = ls.reduce((m, l) => Math.max(m, l.chave), -1) + 1
      return [...ls, { chave, codigo: '', nome: '', ordem: String(maior + 1), novo: true, ambientes: 0, plantas: 0 }]
    })
  }

  function enviar() {
    const lista = []
    for (const l of linhas) {
      const ordem = inteiro(l.ordem)
      if (!/^[a-z0-9][a-z0-9-]*$/.test(l.codigo)) {
        return setAviso(`Código de pavimento inválido: "${l.codigo}". Use letras minúsculas, dígitos e hífen.`)
      }
      if (!l.nome.trim()) return setAviso(`Informe o nome do pavimento ${l.codigo}.`)
      if (ordem === null) return setAviso(`A ordem do pavimento ${l.codigo} precisa ser um número inteiro.`)
      lista.push({ codigo: l.codigo, nome: l.nome.trim(), ordem })
    }
    setAviso(null)
    salvar.mutate(lista, { onSuccess: onSalvo })
  }

  return (
    <section className="adm-secao" aria-labelledby="titulo-pavimentos">
      <h2 id="titulo-pavimentos">Pavimentos</h2>
      <table className="adm-tabela">
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Nome</th>
            <th scope="col">Ordem</th>
            <th scope="col" className="adm-num">
              Ambientes
            </th>
            <th scope="col">
              <span className="adm-oculto">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 && (
            <tr>
              <td colSpan={5} className="adm-dica">
                Nenhum pavimento.
              </td>
            </tr>
          )}
          {linhas.map((l, i) => {
            const preso = l.ambientes > 0 || l.plantas > 0
            return (
              <tr key={l.chave}>
                <td>
                  {l.novo ? (
                    <input
                      aria-label={`Código do pavimento ${i + 1}`}
                      value={l.codigo}
                      onChange={(e) => mudar(l.chave, 'codigo', e.target.value.trim())}
                      placeholder="ex.: terreo"
                    />
                  ) : (
                    <code>{l.codigo}</code>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Nome do pavimento ${i + 1}`}
                    value={l.nome}
                    onChange={(e) => mudar(l.chave, 'nome', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Ordem do pavimento ${i + 1}`}
                    className="adm-input-curto"
                    value={l.ordem}
                    inputMode="numeric"
                    onChange={(e) => mudar(l.chave, 'ordem', e.target.value)}
                  />
                </td>
                <td className="adm-num">{l.ambientes}</td>
                <td>
                  <button
                    type="button"
                    className="adm-botao adm-botao-discreto"
                    disabled={preso}
                    title={preso ? 'Pavimento com ambientes ou plantas não pode ser apagado' : undefined}
                    aria-label={`Remover pavimento ${l.codigo || i + 1}`}
                    onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="adm-dica">O código vai para os códigos dos ambientes e para os caminhos das imagens: não muda depois de criado.</p>
      <Resultado sucesso={sucesso} erro={aviso ? new Error(aviso) : salvar.error} />
      <div className="adm-acoes">
        <button type="button" className="adm-botao" onClick={incluir}>
          Incluir pavimento
        </button>
        <button type="button" className="adm-botao adm-botao-principal" disabled={salvar.isPending} onClick={enviar}>
          Salvar pavimentos
        </button>
      </div>
    </section>
  )
}

// --- Configuração ----------------------------------------------------------------------------

interface Par {
  chave: number
  de: string
  para: string
}

function paresDe(obj: unknown): Par[] {
  if (typeof obj !== 'object' || obj === null) return []
  return Object.entries(obj as Record<string, unknown>).map(([de, para], i) => ({ chave: i, de, para: String(para) }))
}

/** Converte os pares em objeto; erro se houver chave vazia ou repetida. */
function objetoDe(pares: Par[], titulo: string): Record<string, string> | string {
  const obj: Record<string, string> = {}
  for (const p of pares) {
    const de = p.de.trim()
    if (!de && !p.para.trim()) continue
    if (!de) return `${titulo}: há uma linha sem o nome na planta.`
    if (de in obj) return `${titulo}: "${de}" aparece mais de uma vez.`
    obj[de] = p.para.trim()
  }
  return obj
}

function Pares({
  titulo,
  descricao,
  rotuloDe,
  rotuloPara,
  pares,
  onMudar,
  categorias,
}: {
  titulo: string
  descricao: string
  rotuloDe: string
  rotuloPara: string
  pares: Par[]
  onMudar: (p: Par[]) => void
  /** O valor é uma categoria: o mesmo select do editor de planta. */
  categorias?: boolean
}) {
  const mudar = (chave: number, campo: 'de' | 'para', valor: string) =>
    onMudar(pares.map((p) => (p.chave === chave ? { ...p, [campo]: valor } : p)))
  return (
    <fieldset className="adm-pares">
      <legend>{titulo}</legend>
      <p className="adm-dica">{descricao}</p>
      <table className="adm-tabela">
        <thead>
          <tr>
            <th scope="col">{rotuloDe}</th>
            <th scope="col">{rotuloPara}</th>
            <th scope="col">
              <span className="adm-oculto">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pares.map((p, i) => (
            <tr key={p.chave}>
              <td>
                <input aria-label={`${rotuloDe} ${i + 1}`} value={p.de} onChange={(e) => mudar(p.chave, 'de', e.target.value)} />
              </td>
              <td>
                {categorias ? (
                  <SelectCategoria
                    valor={p.para}
                    rotulo={`${rotuloPara} ${i + 1}`}
                    onMudar={(v) => mudar(p.chave, 'para', v)}
                  />
                ) : (
                  <input
                    aria-label={`${rotuloPara} ${i + 1}`}
                    value={p.para}
                    onChange={(e) => mudar(p.chave, 'para', e.target.value)}
                  />
                )}
              </td>
              <td>
                <button
                  type="button"
                  className="adm-botao adm-botao-discreto"
                  aria-label={`Remover ${titulo.toLowerCase()} ${i + 1}`}
                  onClick={() => onMudar(pares.filter((x) => x.chave !== p.chave))}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="adm-botao"
        onClick={() => onMudar([...pares, { chave: pares.reduce((m, p) => Math.max(m, p.chave), -1) + 1, de: '', para: '' }])}
      >
        Incluir em {titulo.toLowerCase()}
      </button>
    </fieldset>
  )
}

const CAMPOS_EDITADOS = ['status', 'nomes_fixos', 'categorias']

function Configuracao({ dados, sucesso, onSalvo }: PropsSecao & { dados: DadosObraAdmin }) {
  const salvar = useSalvarConfig(dados.obra.slug)
  const original: ConfigObra = dados.config ?? {}
  const [status, setStatus] = useState<StatusObra>(original.status ?? 'aguardando_revisao_humana')
  const [nomes, setNomes] = useState<Par[]>(() => paresDe(original.nomes_fixos))
  const [categorias, setCategorias] = useState<Par[]>(() => paresDe(original.categorias))
  const [aviso, setAviso] = useState<string | null>(null)
  const outros = Object.keys(original).filter((k) => !CAMPOS_EDITADOS.includes(k))

  function enviar() {
    const n = objetoDe(nomes, 'Nomes fixos')
    if (typeof n === 'string') return setAviso(n)
    const c = objetoDe(categorias, 'Categorias')
    if (typeof c === 'string') return setAviso(c)
    setAviso(null)
    salvar.mutate({ ...original, status, nomes_fixos: n, categorias: c }, { onSuccess: onSalvo })
  }

  return (
    <section className="adm-secao" aria-labelledby="titulo-config">
      <h2 id="titulo-config">Configuração</h2>
      <p className="adm-dica">
        {dados.config_atualizada_em
          ? `Atualizada em ${new Date(dados.config_atualizada_em).toLocaleString('pt-BR')}${
              dados.config_atualizada_por ? ` por ${dados.config_atualizada_por}` : ''
            }.`
          : 'Obra ainda sem configuração.'}
        {typeof original.revisao === 'string' && ` Revisão da planta: ${original.revisao}.`}
      </p>
      <label className="adm-campo">
        Status da revisão humana
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusObra)}>
          {(Object.keys(ROTULO_STATUS) as StatusObra[]).map((s) => (
            <option key={s} value={s}>
              {ROTULO_STATUS[s]}
            </option>
          ))}
        </select>
      </label>
      <Pares
        titulo="Nomes fixos"
        descricao="Abreviações da planta e o nome operacional que aparece no app (ex.: VEST. FEM. → Vestiário feminino)."
        rotuloDe="Nome na planta"
        rotuloPara="Nome operacional"
        pares={nomes}
        onMudar={setNomes}
      />
      <Pares
        titulo="Categorias"
        descricao="Nome na planta e a categoria do ambiente. Sem entrada, vale a regra do extrator."
        rotuloDe="Padrão na planta"
        rotuloPara="Categoria"
        pares={categorias}
        onMudar={setCategorias}
        categorias
      />
      {outros.length > 0 && (
        <p className="adm-dica">Outros campos mantidos como estão: {outros.join(', ')}.</p>
      )}
      <Resultado sucesso={sucesso} erro={aviso ? new Error(aviso) : salvar.error} />
      <div className="adm-acoes">
        <button type="button" className="adm-botao adm-botao-principal" disabled={salvar.isPending} onClick={enviar}>
          Salvar configuração
        </button>
      </div>
    </section>
  )
}

// --- Planta ----------------------------------------------------------------------------------

function Planta({ slug, pavimentos }: { slug: string; pavimentos: PavimentoAdmin[] }) {
  return (
    <section className="adm-secao" aria-labelledby="titulo-planta">
      <h2 id="titulo-planta">Planta (PDF)</h2>
      <p className="adm-dica">
        Envie o PDF de arquitetura de cada pavimento, ajuste recorte, nomes e pinos e publique. O processamento é feito
        neste navegador.
      </p>
      {pavimentos.length === 0 ? (
        <p className="adm-dica">Cadastre os pavimentos acima antes de enviar a planta.</p>
      ) : (
        <ul className="adm-lista-limpa adm-acoes">
          {pavimentos.map((p) => (
            <li key={p.codigo}>
              <Link className="adm-botao" to={`/obras/${slug}/planta/${p.codigo}`}>
                Planta de {p.nome}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// --- Modelo 3D -------------------------------------------------------------------------------

function Modelo3d({ slug }: { slug: string }) {
  return (
    <section className="adm-secao" aria-labelledby="titulo-modelo-3d">
      <h2 id="titulo-modelo-3d">Modelo 3D</h2>
      <p className="adm-dica">
        Modelos por disciplina para o visualizador do Mini App: envie o IFC (convertido neste navegador) ou o .frag pronto.
      </p>
      <Link className="adm-botao" to={`/obras/${slug}/modelos`}>
        Modelos 3D
      </Link>
    </section>
  )
}

// --- Realidade aumentada ---------------------------------------------------------------------

function RealidadeAumentada({ slug }: { slug: string }) {
  return (
    <section className="adm-secao" aria-labelledby="titulo-ra-obra">
      <h2 id="titulo-ra-obra">Realidade aumentada</h2>
      <p className="adm-dica">
        QR code de cada ambiente: marque a posição na parede e imprima a folha A4 no tamanho exato.
      </p>
      <Link className="adm-botao" to={`/obras/${slug}/ra`}>
        Realidade aumentada
      </Link>
    </section>
  )
}

// --- Exportar --------------------------------------------------------------------------------

export function baixarJson(nomeArquivo: string, dados: unknown): void {
  const blob = new Blob([JSON.stringify(dados, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Exportar({ slug }: { slug: string }) {
  const exportar = useExportarObra()
  return (
    <section className="adm-secao" aria-labelledby="titulo-exportar">
      <h2 id="titulo-exportar">Exportar</h2>
      <p className="adm-dica">Cópia de segurança em JSON: obra, pavimentos, configuração, ambientes e plantas.</p>
      {exportar.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(exportar.error)}
        </p>
      )}
      <button
        type="button"
        className="adm-botao"
        disabled={exportar.isPending}
        onClick={() =>
          exportar.mutate(slug, {
            onSuccess: (dados) => baixarJson(`${slug}-${new Date().toISOString().slice(0, 10)}.json`, dados),
          })
        }
      >
        Exportar JSON
      </button>
    </section>
  )
}
