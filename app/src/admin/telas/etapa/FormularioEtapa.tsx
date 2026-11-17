/**
 * Formulário do cadastro da etapa, o mesmo na criação (`/nova-etapa`) e na edição
 * (`/etapas/:slug`): Identificação, Localização e Dados do contrato. As regras de verdade ficam
 * nas RPCs (`admin_salvar_etapa`); aqui só o que poupa uma ida ao servidor.
 */
import { lazy, Suspense, useCallback, useMemo, useState, type FormEvent } from 'react'
import { Campo, Resultado } from '../../componentes.tsx'
import { useOrganizacao, useSalvarEtapa } from '../../dados/hooks.ts'
import {
  ESTACAO_PADRAO,
  ESTACAO_RESERVA_PADRAO,
  ESTACOES_OBSERVATORIO,
  FUSOS,
  type CamposEtapa,
  type DadosEtapa,
  type EtapaDetalhe,
  type EtapaSalva,
} from '../../dados/tipos.ts'
import {
  CNPJ,
  coordenada,
  hojeIso,
  lerCoordenadas,
  lerDecimal,
  lerMoeda,
  mascaraCnpj,
  mascaraMoeda,
  numeroBoletim,
  textoArea,
  textoDecimal,
  textoMoeda,
} from '../../formato.ts'

const SLUG = /^[a-z0-9-]+$/
const SIGLA = /^[A-Z0-9]{1,10}$/
const ESTACAO = /^[0-9]{3,6}$/

function inteiro(texto: string): number | null {
  return /^-?\d{1,9}$/.test(texto.trim()) ? Number(texto) : null
}

/** Todos os campos como texto, do jeito que os controles guardam. */
interface Valores {
  nome: string
  slug: string
  ordem: string
  sigla: string
  endereco: string
  latitude: string
  longitude: string
  fuso: string
  estacao: string
  estacao_reserva: string
  boletim_horario: string
  objeto: string
  local: string
  contratante: string
  contrato: string
  contratada: string
  contratada_cnpj: string
  os_numero: string
  os_data: string
  vigencia_meses: string
  valor_original: string
  area_construida_m2: string
}

function valoresDe(e: EtapaDetalhe | null): Valores {
  return {
    nome: e?.nome ?? '',
    slug: e?.slug ?? '',
    ordem: String(e?.ordem ?? 0),
    sigla: e?.sigla ?? '',
    endereco: e?.endereco ?? '',
    latitude: textoDecimal(e?.latitude),
    longitude: textoDecimal(e?.longitude),
    fuso: e?.fuso ?? 'America/Sao_Paulo',
    // Na criação, Montese e, de reserva, Benfica.
    estacao: e ? (e.estacao ?? '') : ESTACAO_PADRAO,
    estacao_reserva: e ? (e.estacao_reserva ?? '') : ESTACAO_RESERVA_PADRAO,
    boletim_horario: e?.boletim_horario ?? '23:30',
    objeto: e?.objeto ?? '',
    local: e?.local ?? '',
    contratante: e?.contratante ?? '',
    contrato: e?.contrato ?? '',
    contratada: e?.contratada ?? '',
    contratada_cnpj: e?.contratada_cnpj ?? '',
    os_numero: e?.os_numero ?? '',
    os_data: e?.os_data ?? '',
    vigencia_meses: e?.vigencia_meses == null ? '' : String(e.vigencia_meses),
    valor_original: textoMoeda(e?.valor_original),
    area_construida_m2: textoArea(e?.area_construida_m2),
  }
}

/** Chave que muda quando o cadastro salvo muda (a página recria o formulário com os dados novos). */
export function chaveDoCadastro(e: EtapaDetalhe): string {
  return JSON.stringify(valoresDe(e))
}

const texto = (v: string): string | null => (v.trim() === '' ? null : v.trim())

class ErroDeCampo extends Error {}

/** Lê os campos do cadastro; lança `ErroDeCampo` com a mensagem para o usuário. */
function lerCampos(v: Valores): CamposEtapa {
  const falha = (m: string): never => {
    throw new ErroDeCampo(m)
  }
  const sigla = texto(v.sigla)
  if (sigla !== null && !SIGLA.test(sigla)) falha('Sigla inválida: use de 1 a 10 letras maiúsculas ou dígitos.')

  let latitude: number | null = null
  let longitude: number | null = null
  if (texto(v.latitude) !== null || texto(v.longitude) !== null) {
    latitude = lerDecimal(v.latitude)
    longitude = lerDecimal(v.longitude)
    if (latitude === null || longitude === null) falha('Informe latitude e longitude como números, por exemplo -3,7610 e -38,5297.')
    if (latitude! < -34 || latitude! > 6) falha('Latitude fora do Brasil: use um valor entre -34 e 6.')
    if (longitude! < -74 || longitude! > -28) falha('Longitude fora do Brasil: use um valor entre -74 e -28.')
  }

  const principal = texto(v.estacao)
  const reserva = texto(v.estacao_reserva)
  for (const e of [principal, reserva]) {
    if (e !== null && !ESTACAO.test(e)) falha('Código de estação inválido: de 3 a 6 dígitos, como 8836.')
  }
  if (principal !== null && principal === reserva) falha('A estação de reserva precisa ser diferente da principal.')

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.boletim_horario)) falha('Informe o horário de emissão do boletim.')

  const cnpj = texto(v.contratada_cnpj)
  if (cnpj !== null && !CNPJ.test(cnpj)) falha('CNPJ incompleto: use o formato 00.000.000/0000-00.')

  let vigencia: number | null = null
  if (texto(v.vigencia_meses) !== null) {
    vigencia = inteiro(v.vigencia_meses)
    if (vigencia === null || vigencia < 1 || vigencia > 240) falha('A vigência precisa estar entre 1 e 240 meses.')
  }
  let valor: number | null = null
  if (texto(v.valor_original) !== null) {
    valor = lerMoeda(v.valor_original)
    if (valor === null) falha('Valor original inválido.')
  }
  let area: number | null = null
  if (texto(v.area_construida_m2) !== null) {
    area = lerDecimal(v.area_construida_m2)
    if (area === null || area <= 0) falha('A área construída precisa ser um número maior que zero.')
  }

  return {
    sigla,
    endereco: texto(v.endereco),
    latitude,
    longitude,
    fuso: v.fuso,
    estacao: principal,
    estacao_reserva: reserva,
    boletim_horario: v.boletim_horario,
    objeto: texto(v.objeto),
    local: texto(v.local),
    contratante: texto(v.contratante),
    contrato: texto(v.contrato),
    contratada: texto(v.contratada),
    contratada_cnpj: cnpj,
    os_numero: texto(v.os_numero),
    os_data: texto(v.os_data),
    vigencia_meses: vigencia,
    valor_original: valor,
    area_construida_m2: area,
  }
}

interface Props {
  /** Etapa em edição; sem ela, é a criação. */
  etapa: EtapaDetalhe | null
  sucesso?: string | null
  onSalvo: (e: EtapaSalva) => void
}

export default function FormularioEtapa({ etapa, sucesso = null, onSalvo }: Props) {
  const salvar = useSalvarEtapa()
  const org = useOrganizacao()
  const [v, setV] = useState<Valores>(() => valoresDe(etapa))
  const [aviso, setAviso] = useState<string | null>(null)
  const criacao = etapa === null
  const mudar = (campo: keyof Valores, valor: string) => {
    setV((a) => ({ ...a, [campo]: valor }))
    setAviso(null)
  }

  // Colar "lat, lon" em qualquer dos dois campos preenche os dois.
  function mudarCoordenada(campo: 'latitude' | 'longitude', valor: string) {
    const par = lerCoordenadas(valor)
    if (par) {
      setV((a) => ({ ...a, latitude: textoDecimal(par.latitude), longitude: textoDecimal(par.longitude) }))
      setAviso(null)
    } else {
      mudar(campo, valor)
    }
  }

  // Tocar no mapa preenche os dois campos.
  const escolherNoMapa = useCallback((latitude: number, longitude: number) => {
    setV((a) => ({ ...a, latitude: textoDecimal(latitude), longitude: textoDecimal(longitude) }))
    setAviso(null)
  }, [])

  const ponto = useMemo(() => {
    const latitude = lerDecimal(v.latitude)
    const longitude = lerDecimal(v.longitude)
    if (latitude === null || longitude === null) return null
    if (latitude < -34 || latitude > 6 || longitude < -74 || longitude > -28) return null
    return { latitude, longitude }
  }, [v.latitude, v.longitude])

  function enviar(e: FormEvent) {
    e.preventDefault()
    setAviso(null)
    try {
      const ordem = inteiro(v.ordem)
      if (criacao && (!SLUG.test(v.slug) || v.slug.length > 40)) {
        throw new ErroDeCampo('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres).')
      }
      if (!v.nome.trim()) throw new ErroDeCampo('Informe o nome da etapa.')
      if (ordem === null) throw new ErroDeCampo('A ordem precisa ser um número inteiro.')
      const campos = lerCampos(v)
      if (campos.sigla === null && (criacao || etapa.sigla !== null)) {
        throw new ErroDeCampo(criacao ? 'Informe a sigla da etapa.' : 'A sigla não pode ser apagada.')
      }
      if (criacao && (campos.latitude === null || campos.longitude === null)) {
        throw new ErroDeCampo('Informe a latitude e a longitude da obra.')
      }
      let dados: DadosEtapa
      if (criacao) {
        const preenchidos = Object.fromEntries(Object.entries(campos).filter(([, x]) => x !== null))
        dados = { slug: v.slug, nome: v.nome.trim(), ordem, ...preenchidos }
      } else {
        // Só o que mudou: chave ausente mantém o valor no banco.
        const atual = valoresDe(etapa)
        const anteriores = lerCampos(atual)
        const mudados = Object.fromEntries(
          (Object.keys(campos) as (keyof CamposEtapa)[]).filter((k) => campos[k] !== anteriores[k]).map((k) => [k, campos[k]]),
        )
        dados = { id: etapa.id, nome: v.nome.trim(), ordem, ...mudados }
      }
      salvar.mutate(dados, { onSuccess: onSalvo })
    } catch (erro) {
      if (erro instanceof ErroDeCampo) setAviso(erro.message)
      else throw erro
    }
  }

  const siglaValida = SIGLA.test(v.sigla)
  const exemplo = siglaValida ? numeroBoletim(v.sigla, hojeIso(), org.data?.nome ?? '') : null

  return (
    <form className="adm-form adm-form-etapa" onSubmit={enviar} noValidate aria-label={criacao ? 'Nova etapa' : 'Cadastro da etapa'}>
      <section className="adm-secao" aria-labelledby="titulo-identificacao">
        <h2 id="titulo-identificacao">Identificação</h2>
        <div className="adm-grade">
          <Campo
            rotulo="Slug"
            obrigatorio={criacao}
            dica={
              criacao ? (
                <>
                  Letras minúsculas, dígitos e hífen. Vai no comando <code>/vincular_etapa</code> e não muda depois de criado.
                </>
              ) : undefined
            }
          >
            {(p) =>
              criacao ? (
                <input {...p} value={v.slug} onChange={(e) => mudar('slug', e.target.value.trim())} placeholder="ex.: 3a-etapa" />
              ) : (
                <input {...p} value={v.slug} readOnly disabled />
              )
            }
          </Campo>
          <Campo rotulo="Nome" obrigatorio>
            {(p) => (
              <input {...p} value={v.nome} onChange={(e) => mudar('nome', e.target.value)} maxLength={120} placeholder="ex.: 3ª ETAPA" />
            )}
          </Campo>
          <Campo rotulo="Ordem" dica="Posição na lista de etapas do site e no seletor do Mini App.">
            {(p) => <input {...p} value={v.ordem} onChange={(e) => mudar('ordem', e.target.value)} inputMode="numeric" />}
          </Campo>
          <Campo
            rotulo="Sigla"
            obrigatorio
            dica={
              exemplo ? (
                <>
                  Número do boletim: <strong>{exemplo}</strong>
                </>
              ) : (
                'De 1 a 10 letras ou dígitos (ex.: 2). Forma o número do boletim, BA<sigla>/aammdd/<OM>.'
              )
            }
          >
            {(p) => (
              <input
                {...p}
                value={v.sigla}
                onChange={(e) => mudar('sigla', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={10}
                placeholder="ex.: 2"
              />
            )}
          </Campo>
        </div>
      </section>

      <section className="adm-secao" aria-labelledby="titulo-localizacao">
        <h2 id="titulo-localizacao">Localização</h2>
        <div className="adm-grade">
          <Campo rotulo="Endereço" largo>
            {(p) => <input {...p} value={v.endereco} onChange={(e) => mudar('endereco', e.target.value)} maxLength={300} />}
          </Campo>
          <Campo rotulo="Latitude" obrigatorio dica="Toque no mapa abaixo ou cole “−3.7610, −38.5297” aqui: os dois campos são preenchidos.">
            {(p) => (
              <input
                {...p}
                value={v.latitude}
                onChange={(e) => mudarCoordenada('latitude', e.target.value)}
                inputMode="decimal"
                placeholder="-3,7610"
              />
            )}
          </Campo>
          <Campo rotulo="Longitude" obrigatorio>
            {(p) => (
              <input
                {...p}
                value={v.longitude}
                onChange={(e) => mudarCoordenada('longitude', e.target.value)}
                inputMode="decimal"
                placeholder="-38,5297"
              />
            )}
          </Campo>
          <MapaPrevia ponto={ponto} aoEscolher={escolherNoMapa} />
          <Campo rotulo="Fuso horário" obrigatorio dica="Define o dia do boletim e a hora da emissão automática.">
            {(p) => (
              <select {...p} value={v.fuso} onChange={(e) => mudar('fuso', e.target.value)}>
                {FUSOS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="Horário de emissão" dica="Hora local da emissão automática do boletim.">
            {(p) => (
              <input {...p} type="time" value={v.boletim_horario} onChange={(e) => mudar('boletim_horario', e.target.value)} />
            )}
          </Campo>
          <CampoEstacao
            rotulo="Estação meteorológica"
            dica="Estação do Observatório de Fortaleza copiada no boletim (tabela “Últimas 24 horas”)."
            valor={v.estacao}
            onMudar={(x) => mudar('estacao', x)}
          />
          <CampoEstacao
            rotulo="Estação de reserva"
            dica="Usada quando a principal está sem leitura nas últimas 3 horas."
            valor={v.estacao_reserva}
            onMudar={(x) => mudar('estacao_reserva', x)}
          />
        </div>
      </section>

      <section className="adm-secao" aria-labelledby="titulo-contrato">
        <h2 id="titulo-contrato">Dados do contrato</h2>
        <div className="adm-grade">
          <Campo rotulo="Obra/serviço" largo dica="Texto de “OBRA/SERVIÇO” do boletim.">
            {(p) => <textarea {...p} value={v.objeto} onChange={(e) => mudar('objeto', e.target.value)} maxLength={600} rows={2} />}
          </Campo>
          <Campo rotulo="Local" largo dica="Texto de “LOCAL” do boletim; pode ter mais de uma linha.">
            {(p) => <textarea {...p} value={v.local} onChange={(e) => mudar('local', e.target.value)} maxLength={300} rows={2} />}
          </Campo>
          <Campo rotulo="Contratante">
            {(p) => <input {...p} value={v.contratante} onChange={(e) => mudar('contratante', e.target.value)} maxLength={200} />}
          </Campo>
          <Campo rotulo="Contrato" dica="Ex.: 120/2025 - SOP">
            {(p) => <input {...p} value={v.contrato} onChange={(e) => mudar('contrato', e.target.value)} maxLength={60} />}
          </Campo>
          <Campo rotulo="Contratada">
            {(p) => <input {...p} value={v.contratada} onChange={(e) => mudar('contratada', e.target.value)} maxLength={200} />}
          </Campo>
          <Campo rotulo="CNPJ da contratada">
            {(p) => (
              <input
                {...p}
                value={v.contratada_cnpj}
                onChange={(e) => mudar('contratada_cnpj', mascaraCnpj(e.target.value))}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
              />
            )}
          </Campo>
          <Campo rotulo="Número da OS">
            {(p) => <input {...p} value={v.os_numero} onChange={(e) => mudar('os_numero', e.target.value)} maxLength={40} />}
          </Campo>
          <Campo rotulo="Data da OS">
            {(p) => <input {...p} type="date" value={v.os_data} onChange={(e) => mudar('os_data', e.target.value)} />}
          </Campo>
          <Campo rotulo="Vigência (meses)" dica="De 1 a 240. O término vem da data da OS mais a vigência.">
            {(p) => (
              <input
                {...p}
                value={v.vigencia_meses}
                onChange={(e) => mudar('vigencia_meses', e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            )}
          </Campo>
          <Campo rotulo="Valor original (R$)">
            {(p) => (
              <input
                {...p}
                value={v.valor_original}
                onChange={(e) => mudar('valor_original', mascaraMoeda(e.target.value))}
                inputMode="numeric"
                placeholder="0,00"
              />
            )}
          </Campo>
          <Campo rotulo="Área construída (m²)">
            {(p) => (
              <input
                {...p}
                value={v.area_construida_m2}
                onChange={(e) => mudar('area_construida_m2', e.target.value)}
                inputMode="decimal"
                placeholder="86.102,17"
              />
            )}
          </Campo>
        </div>
      </section>

      <Resultado sucesso={sucesso} erro={aviso ? new Error(aviso) : salvar.error} />
      <div>
        <button type="submit" className="adm-botao adm-botao-principal" disabled={salvar.isPending}>
          {criacao ? 'Criar etapa' : 'Salvar etapa'}
        </button>
      </div>
    </form>
  )
}

// --- Mapa ------------------------------------------------------------------------------------

const MapaEscolha = lazy(() => import('./MapaEscolha.tsx'))

/** Mapa clicável (toque marca o local) com as coordenadas e o link para abrir no OpenStreetMap. */
export function MapaPrevia({
  ponto,
  aoEscolher,
}: {
  ponto: { latitude: number; longitude: number } | null
  aoEscolher: (latitude: number, longitude: number) => void
}) {
  return (
    <figure className="adm-mapa adm-campo-largo">
      <Suspense fallback={<div className="adm-mapa-escolha" aria-hidden="true" />}>
        <MapaEscolha ponto={ponto} aoEscolher={aoEscolher} />
      </Suspense>
      <figcaption>
        {ponto ? (
          <>
            {coordenada(ponto.latitude)}, {coordenada(ponto.longitude)} ·{' '}
            <a
              href={`https://www.openstreetmap.org/?mlat=${ponto.latitude}&mlon=${ponto.longitude}#map=17/${ponto.latitude}/${ponto.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              abrir no mapa
            </a>
          </>
        ) : (
          <span data-testid="mapa-vazio">Toque no mapa para marcar o local da obra.</span>
        )}
      </figcaption>
    </figure>
  )
}

// --- Estação do Observatório ----------------------------------------------------------------

/** Lista fixa das estações do Observatório de Fortaleza (mantém um código fora da lista, se já existir). */
function CampoEstacao({
  rotulo,
  dica,
  valor,
  onMudar,
}: {
  rotulo: string
  dica: string
  valor: string
  onMudar: (v: string) => void
}) {
  const fora = valor !== '' && !ESTACOES_OBSERVATORIO.some((s) => s.codigo === valor)
  return (
    <Campo rotulo={rotulo} dica={dica}>
      {(p) => (
        <select {...p} value={valor} onChange={(e) => onMudar(e.target.value)}>
          <option value="">Nenhuma</option>
          {fora && <option value={valor}>{valor} (atual)</option>}
          {ESTACOES_OBSERVATORIO.map((s) => (
            <option key={s.codigo} value={s.codigo}>
              {s.nome} ({s.codigo})
            </option>
          ))}
        </select>
      )}
    </Campo>
  )
}
