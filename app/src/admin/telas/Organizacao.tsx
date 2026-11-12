/**
 * Identidade da organização militar (`/organizacao`): nome da OM e logo, que aparecem na barra
 * do site e na faixa do topo de todas as telas do Mini App. O logo vai para o bucket público
 * `organizacao` (PNG, JPEG ou WebP, até 1 MB), com nome novo a cada troca.
 */
import { useId, useState, type ChangeEvent, type FormEvent } from 'react'
import { ComDados, Resultado } from '../componentes.tsx'
import { useOrganizacao, useSalvarOrganizacao } from '../dados/hooks.ts'
import { NOME_OM_MAX, problemaDoLogo, TIPOS_LOGO, type Organizacao as DadosOrganizacao } from '../dados/tipos.ts'

export default function Organizacao() {
  const org = useOrganizacao()
  // Fica aqui: o formulário é recriado quando os dados salvos voltam do servidor.
  const [sucesso, setSucesso] = useState<string | null>(null)
  return (
    <section aria-labelledby="titulo-organizacao">
      <h1 id="titulo-organizacao">Organização</h1>
      <p className="adm-dica">
        Nome e logo da organização militar: aparecem na barra deste site e no topo de todas as telas do Mini App.
      </p>
      <ComDados consulta={org}>
        {(d) => <Formulario key={`${d.nome}|${d.logo_path ?? ''}`} atual={d} sucesso={sucesso} setSucesso={setSucesso} />}
      </ComDados>
    </section>
  )
}

/** Lê a imagem escolhida como data URL, para a pré-visualização. */
function lerComoDataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(String(leitor.result))
    leitor.onerror = () => rejeitar(leitor.error ?? new Error('Falha ao ler o arquivo'))
    leitor.readAsDataURL(arquivo)
  })
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`

interface Props {
  atual: DadosOrganizacao
  sucesso: string | null
  setSucesso: (s: string | null) => void
}

function Formulario({ atual, sucesso, setSucesso }: Props) {
  const salvar = useSalvarOrganizacao()
  const idDica = useId()
  const [nome, setNome] = useState(atual.nome)
  /** Logo novo escolhido (ainda não enviado) e a pré-visualização dele. */
  const [novo, setNovo] = useState<{ arquivo: File; url: string } | null>(null)
  const [remover, setRemover] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const previa = novo?.url ?? (remover ? null : atual.logo_url)
  const mudou = nome.trim() !== atual.nome || novo !== null || (remover && atual.logo_path !== null)

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    setSucesso(null)
    if (!arquivo) return
    const problema = problemaDoLogo(arquivo)
    if (problema) {
      setAviso(problema)
      return
    }
    try {
      setNovo({ arquivo, url: await lerComoDataUrl(arquivo) })
      setRemover(false)
      setAviso(null)
    } catch {
      setAviso('Não foi possível ler a imagem escolhida.')
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    const n = nome.trim()
    if (!n) return setAviso('Informe o nome da OM.')
    if (n.length > NOME_OM_MAX) return setAviso(`O nome da OM pode ter até ${NOME_OM_MAX} caracteres.`)
    setAviso(null)
    setSucesso(null)
    salvar.mutate(
      { nome: n, logo: novo?.arquivo ?? null, logo_path: remover ? null : atual.logo_path },
      { onSuccess: () => setSucesso('Organização salva.') },
    )
  }

  return (
    <form className="adm-secao adm-form adm-form-org" onSubmit={enviar} aria-label="Identidade da organização">
      <div className="adm-campo-com-dica">
        <label>
          Nome da OM
          <input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value)
            setSucesso(null)
          }}
          maxLength={NOME_OM_MAX}
          aria-describedby={`${idDica}-nome`}
          required
          />
        </label>
        <span className="adm-dica" id={`${idDica}-nome`} aria-live="polite">
          {nome.length}/{NOME_OM_MAX} caracteres.
        </span>
      </div>

      <fieldset className="adm-pares">
        <legend>Logo</legend>
        <div className="adm-logo-linha">
          <div className="adm-logo-previa" aria-live="polite">
            {previa ? (
              <img src={previa} alt={novo ? 'Pré-visualização do logo novo' : 'Logo atual da OM'} />
            ) : (
              <span className="adm-dica">Sem logo</span>
            )}
          </div>
          <div>
            {novo && (
              <p className="adm-dica">
                Logo novo: {novo.arquivo.name} ({kb(novo.arquivo.size)}). Ainda não salvo.
              </p>
            )}
            {remover && !novo && <p className="adm-dica">O logo será removido ao salvar.</p>}
            <p className="adm-dica" id={`${idDica}-logo`}>
              PNG, JPEG ou WebP, até 1 MB. Aparece com 28 px de altura no Mini App; prefira fundo transparente.
            </p>
            <div className="adm-acoes">
              <label className="adm-botao adm-botao-arquivo">
                {previa ? 'Trocar logo…' : 'Enviar logo…'}
                <input
                  type="file"
                  className="adm-oculto"
                  accept={Object.keys(TIPOS_LOGO).join(',')}
                  aria-describedby={`${idDica}-logo`}
                  onChange={(e) => void escolher(e)}
                />
              </label>
              {novo && (
                <button type="button" className="adm-botao" onClick={() => setNovo(null)}>
                  Desfazer troca
                </button>
              )}
              {!novo && atual.logo_path && !remover && (
                <button
                  type="button"
                  className="adm-botao"
                  onClick={() => {
                    setRemover(true)
                    setSucesso(null)
                  }}
                >
                  Remover logo
                </button>
              )}
              {remover && !novo && (
                <button type="button" className="adm-botao" onClick={() => setRemover(false)}>
                  Manter logo
                </button>
              )}
            </div>
          </div>
        </div>
      </fieldset>

      <Resultado sucesso={sucesso} erro={aviso ? new Error(aviso) : salvar.error} />
      <div>
        <button type="submit" className="adm-botao adm-botao-principal" disabled={salvar.isPending || !mudou}>
          {salvar.isPending ? 'Salvando…' : 'Salvar organização'}
        </button>
      </div>
    </form>
  )
}
