import type { BoletinsAdminRepositorio } from '@modules/relatorios/application/ports/BoletinsAdminRepositorio.port.ts'
import type {
  BoletimDaLista,
  BoletimDetalhe,
  BoletimEmitido,
  EdicaoBoletim,
  PedidoEmissao,
  SnapshotBoletim,
} from '@modules/relatorios/domain/tiposAdmin.ts'
import { dataValida, somarDias } from '@shared/kernel/periodo.ts'
import { dataBr, hojeNoFuso, numeroBoletim } from '../../../admin/formato.ts'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'

/**
 * PDF mínimo (uma página A4 com uma linha de texto ASCII), para "Abrir PDF" e a prévia na fixture.
 */
export function pdfMinimo(texto: string): Uint8Array<ArrayBuffer> {
  const seguro = texto.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '')
  const conteudo = `BT /F1 18 Tf 72 760 Td (${seguro}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let corpo = '%PDF-1.4\n'
  const posicoes: number[] = []
  objetos.forEach((o, i) => {
    posicoes.push(corpo.length)
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = corpo.length
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const p of posicoes) corpo += `${String(p).padStart(10, '0')} 00000 n \n`
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(corpo) as Uint8Array<ArrayBuffer>
}

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Boletim da fixture: o emitido + o que `admin_boletim` e a lista geral acrescentam. */
export type BoletimMemoria = BoletimEmitido & {
  etapa_id: string
  base_numero: string | null
  edicao: EdicaoBoletim | null
  rascunho: { edicao: EdicaoBoletim; atualizado_em: string; atualizado_por_nome: string | null } | null
  snapshot: SnapshotBoletim
}
export type PedidoMemoria = PedidoEmissao & { etapa_id: string; edicao?: EdicaoBoletim }

const CAMPOS_EMITIDO: (keyof BoletimEmitido)[] = [
  'id',
  'data',
  'revisao',
  'numero',
  'emitido_em',
  'emitido_por_nome',
  'pdf_path',
  'publicado',
  'publicacao_estado',
  'publicacao_erro',
  'publicacao_tentativas',
]

function emitidoDe(b: BoletimMemoria): BoletimEmitido {
  const r: Record<string, unknown> = {}
  for (const k of CAMPOS_EMITIDO) r[k] = b[k]
  return copia(r) as unknown as BoletimEmitido
}

function pedidoPublico(p: PedidoMemoria): PedidoEmissao {
  const r: Partial<PedidoMemoria> = copia(p)
  delete r.etapa_id
  delete r.edicao
  return r as PedidoEmissao
}

/** Edição sem nenhuma alteração (como `privado.edicao_vazia`). */
function edicaoVazia(e: EdicaoBoletim): boolean {
  return (
    Object.keys(e.textos ?? {}).length === 0 &&
    (e.ocultos ?? []).length === 0 &&
    (e.fotos_ocultas ?? []).length === 0
  )
}

function validarEdicaoFixture(e: EdicaoBoletim): void {
  const o = e as unknown
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new ErroAdmin('Edição do boletim inválida')
  for (const k of Object.keys(o)) {
    if (k !== 'textos' && k !== 'ocultos' && k !== 'fotos_ocultas') throw new ErroAdmin('Edição do boletim inválida')
  }
}

/** Snapshot pequeno e coerente: uma obra com serviço, pendências, observação e um lançamento tardio. */
export function snapshotFixture(data: string): SnapshotBoletim {
  const foto = (n: string) => ({ path: `etapa/fotos/${data}-${n}.jpg`, largura: 1200, altura: 900 })
  return {
    data,
    obras: [
      {
        id: 'obra-hto',
        nome: 'HTO',
        servicos: [
          {
            id: `srv-${data}-1`,
            pavimento: 'Térreo',
            ambiente: 'Sala 01',
            hora: '09:10',
            autor: 'CP PATRICIO',
            legenda: 'Concretagem da laje concluída',
            fotos: [foto('a'), foto('b')],
          },
          {
            id: `srv-${data}-2`,
            pavimento: '1º pavimento',
            ambiente: 'Corredor',
            hora: '14:40',
            autor: 'CP PATRICIO',
            legenda: null,
            fotos: [foto('c')],
          },
        ],
        pendencias_abertas: [
          {
            id: `pen-${data}-1`,
            pavimento: 'Térreo',
            ambiente: 'Sala 02',
            hora: '10:25',
            autor: 'CP PATRICIO',
            legenda: 'Infiltração na parede norte',
            fotos: [foto('d')],
          },
        ],
        pendencias_encerradas: [
          {
            id: `enc-${data}-1`,
            pavimento: '1º pavimento',
            ambiente: 'Sala 11',
            aberta_em: somarDias(data, -3),
            dias_aberta: 3,
            legenda: 'Tomada sem espelho',
            fotos_registro: [],
            encerramento: { hora: '16:00', autor: 'CP PATRICIO', observacao: 'Espelho instalado', fotos: [foto('e')] },
          },
        ],
        observacoes: [{ hora: '11:30', autor: 'CP PATRICIO', texto: 'Chuva forte pela manhã, sem impacto.', editada: false }],
      },
    ],
    tardios: [
      {
        id: `tar-${data}-1`,
        tipo: 'servico',
        data,
        hora: '17:20',
        recebido_em: `${somarDias(data, 1)}T09:00:00-03:00`,
        obra: 'HTO',
        ambiente: 'Sala 01',
        autor: 'CP PATRICIO',
        texto: 'Limpeza final do pavimento',
      },
    ],
  }
}

export interface EtapaParaBoletim {
  id: string
  slug: string
  nome: string
  sigla: string | null
  fuso: string
  telegram_chat_id: number | null
}

export interface DepsBoletinsAdminFixture {
  boletins: BoletimMemoria[]
  pedidos: PedidoMemoria[]
  etapas: EtapaParaBoletim[]
  nomeOrganizacao: () => Promise<string>
  nomeUsuario: string
  exigirAdmin: () => void
}

export function criarBoletinsAdminFixture(deps: DepsBoletinsAdminFixture): BoletinsAdminRepositorio {
  const { boletins, pedidos, etapas, nomeOrganizacao, nomeUsuario, exigirAdmin } = deps
  let sequenciaPedido = pedidos.length

  function etapaPorSlug(slug: string): EtapaParaBoletim {
    const e = etapas.find((x) => x.slug === slug)
    if (!e) throw new ErroAdmin('Etapa não encontrada')
    return e
  }

  return {
    async listarBoletins(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const ordem = (a: { data: string; revisao: number }, b: { data: string; revisao: number }) =>
        b.data.localeCompare(a.data) || b.revisao - a.revisao
      return {
        boletins: boletins.filter((x) => x.etapa_id === e.id).map(emitidoDe).sort(ordem),
        pedidos: pedidos
          .filter((x) => x.etapa_id === e.id && x.estado !== 'emitido')
          .map(pedidoPublico)
          .sort(ordem),
      }
    },

    async pedirEmissao(slug, data) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      if (!dataValida(data)) throw new ErroAdmin('Data inválida: use AAAA-MM-DD')
      if (data > hojeNoFuso(e.fuso)) throw new ErroAdmin('Não é possível emitir o boletim de uma data futura')
      if (e.sigla === null) throw new ErroAdmin('A etapa não tem sigla')
      if (
        pedidos.some(
          (p) => p.etapa_id === e.id && p.data === data && (p.estado === 'pendente' || p.estado === 'gerando'),
        )
      ) {
        throw new ErroAdmin(`Já existe um pedido de emissão em andamento para ${dataBr(data)}`)
      }
      const doDia = boletins.filter((b) => b.etapa_id === e.id && b.data === data)
      const revisao = doDia.length === 0 ? 0 : Math.max(...doDia.map((b) => b.revisao)) + 1
      const nomeOm = await nomeOrganizacao()
      const numeroDe = (r: number) => numeroBoletim(e.sigla as string, data, nomeOm) + (r > 0 ? `-R${r}` : '')
      const agora = new Date().toISOString()
      // Um pedido que falhou para a mesma revisão volta para a fila.
      const antigo = pedidos.find((p) => p.etapa_id === e.id && p.data === data && p.revisao === revisao)
      if (antigo) {
        Object.assign(antigo, { estado: 'pendente', tentativas: 0, erro: null, atualizado_em: agora })
        return { ...pedidoPublico(antigo), numero: numeroDe(revisao) }
      }
      const novo: PedidoMemoria = {
        id: ++sequenciaPedido,
        etapa_id: e.id,
        data,
        revisao,
        estado: 'pendente',
        tentativas: 0,
        erro: null,
        atualizado_em: agora,
      }
      pedidos.push(novo)
      return { ...pedidoPublico(novo), numero: numeroDe(revisao) }
    },

    async reenviarBoletim(slug, boletimId) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const b = boletins.find((x) => x.id === boletimId && x.etapa_id === e.id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      if (e.telegram_chat_id === null) throw new ErroAdmin('A etapa não tem grupo do Telegram vinculado')
      if (b.publicado || b.publicacao_estado === 'publicado') throw new ErroAdmin('Este boletim já foi publicado no grupo')
      if (b.publicacao_estado === 'pendente' || b.publicacao_estado === 'enviando') {
        throw new ErroAdmin('O envio deste boletim já está em andamento')
      }
      Object.assign(b, { publicacao_estado: 'pendente', publicacao_erro: null, publicacao_tentativas: 0 })
    },

    async excluirBoletim(slug, boletimId) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const b = boletins.find((x) => x.id === boletimId && x.etapa_id === e.id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      const doDia = boletins.filter((x) => x.etapa_id === e.id && x.data === b.data)
      const apagadas = doDia.filter((x) => x.publicacao_estado === 'publicado').length
      for (let i = boletins.length - 1; i >= 0; i--) if (doDia.includes(boletins[i])) boletins.splice(i, 1)
      for (let i = pedidos.length - 1; i >= 0; i--) {
        if (pedidos[i].etapa_id === e.id && pedidos[i].data === b.data) pedidos.splice(i, 1)
      }
      return { numero: b.numero, data: b.data, revisoes: doDia.length, mensagens: { apagadas, falhas: 0 }, arquivos_erro: null }
    },

    async urlPdfBoletim(caminho) {
      exigirAdmin()
      const b = boletins.find((x) => x.pdf_path === caminho)
      if (!b) throw new ErroAdmin('PDF do boletim não encontrado')
      return URL.createObjectURL(new Blob([pdfMinimo(`Boletim ${b.numero} (fixture)`)], { type: 'application/pdf' }))
    },

    async previaBoletim(slug, data) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      if (!dataValida(data)) throw new ErroAdmin('Data inválida: use AAAA-MM-DD')
      if (data > hojeNoFuso(e.fuso)) throw new ErroAdmin('Não é possível gerar a prévia de uma data futura')
      return new Blob([pdfMinimo(`PREVIA - sem numero - ${e.nome} - ${dataBr(data)}`)], { type: 'application/pdf' })
    },

    async listarTodosBoletins(filtro = {}) {
      exigirAdmin()
      const etapa = filtro.etapa ? etapaPorSlug(filtro.etapa) : null
      const noPeriodo = (x: { etapa_id: string; data: string }) =>
        (!etapa || x.etapa_id === etapa.id) &&
        (!filtro.de || x.data >= filtro.de) &&
        (!filtro.ate || x.data <= filtro.ate)
      const nomeDe = (id: string) => etapas.find((e) => e.id === id)?.nome ?? ''
      const slugDe = (id: string) => etapas.find((e) => e.id === id)?.slug ?? ''
      const ordem = (
        a: { data: string; etapa_nome: string; revisao: number },
        b: { data: string; etapa_nome: string; revisao: number },
      ) => b.data.localeCompare(a.data) || a.etapa_nome.localeCompare(b.etapa_nome) || b.revisao - a.revisao
      return {
        boletins: boletins
          .filter(noPeriodo)
          .map(
            (b): BoletimDaLista => ({
              ...emitidoDe(b),
              etapa_slug: slugDe(b.etapa_id),
              etapa_nome: nomeDe(b.etapa_id),
              base_numero: b.base_numero,
              editado: b.edicao !== null,
              tem_rascunho: b.rascunho !== null,
            }),
          )
          .sort(ordem)
          .slice(0, 300),
        pedidos: pedidos
          .filter((p) => p.estado !== 'emitido' && noPeriodo(p))
          .map((p) => ({
            ...pedidoPublico(p),
            etapa_slug: slugDe(p.etapa_id),
            etapa_nome: nomeDe(p.etapa_id),
            editado: p.edicao !== undefined,
          }))
          .sort(ordem),
      }
    },

    async boletim(id) {
      exigirAdmin()
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      const e = etapas.find((x) => x.id === b.etapa_id)!
      const doDia = boletins.filter((x) => x.etapa_id === b.etapa_id && x.data === b.data)
      const detalhe: BoletimDetalhe = {
        ...emitidoDe(b),
        etapa_slug: e.slug,
        etapa_nome: e.nome,
        ultima_revisao: !doDia.some((x) => x.revisao > b.revisao),
        emissao_em_andamento: pedidos.some(
          (p) => p.etapa_id === b.etapa_id && p.data === b.data && (p.estado === 'pendente' || p.estado === 'gerando'),
        ),
        base_numero: b.base_numero,
        edicao: b.edicao,
        snapshot: b.snapshot,
        rascunho: b.rascunho,
      }
      return copia(detalhe)
    },

    async salvarRascunhoBoletim(id, edicao) {
      exigirAdmin()
      validarEdicaoFixture(edicao)
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      if (boletins.some((x) => x.etapa_id === b.etapa_id && x.data === b.data && x.revisao > b.revisao)) {
        throw new ErroAdmin('Só a última revisão do dia pode ser editada')
      }
      if (edicaoVazia(edicao)) {
        b.rascunho = null
        return null
      }
      const atualizado_em = new Date().toISOString()
      b.rascunho = { edicao: copia(edicao), atualizado_em, atualizado_por_nome: nomeUsuario }
      return { atualizado_em }
    },

    async retificarBoletim(id, edicao) {
      exigirAdmin()
      validarEdicaoFixture(edicao)
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      const e = etapas.find((x) => x.id === b.etapa_id)!
      if (boletins.some((x) => x.etapa_id === b.etapa_id && x.data === b.data && x.revisao > b.revisao)) {
        throw new ErroAdmin('Só a última revisão do dia pode ser editada')
      }
      if (edicaoVazia(edicao)) throw new ErroAdmin('Nenhuma alteração para enviar')
      if (
        pedidos.some(
          (p) => p.etapa_id === b.etapa_id && p.data === b.data && (p.estado === 'pendente' || p.estado === 'gerando'),
        )
      ) {
        throw new ErroAdmin('Já há uma emissão em andamento para este dia')
      }
      const revisao = Math.max(...boletins.filter((x) => x.etapa_id === b.etapa_id && x.data === b.data).map((x) => x.revisao)) + 1
      const numero = numeroBoletim(e.sigla ?? '3', b.data, await nomeOrganizacao()) + `-R${revisao}`
      const agora = new Date().toISOString()
      const antigo = pedidos.find((p) => p.etapa_id === b.etapa_id && p.data === b.data && p.revisao === revisao)
      const pedido: PedidoMemoria =
        antigo ?? {
          id: ++sequenciaPedido,
          etapa_id: b.etapa_id,
          data: b.data,
          revisao,
          estado: 'pendente',
          tentativas: 0,
          erro: null,
          atualizado_em: agora,
        }
      Object.assign(pedido, { estado: 'pendente', tentativas: 0, erro: null, atualizado_em: agora, edicao: copia(edicao) })
      if (!antigo) pedidos.push(pedido)
      b.rascunho = { edicao: copia(edicao), atualizado_em: agora, atualizado_por_nome: nomeUsuario }
      return { ...pedidoPublico(pedido), numero }
    },

    async previaBoletimEditado(id, edicao) {
      exigirAdmin()
      validarEdicaoFixture(edicao)
      const b = boletins.find((x) => x.id === id)
      if (!b) throw new ErroAdmin('Boletim não encontrado')
      return new Blob([pdfMinimo(`PREVIA EDITADA - sem numero - ${b.numero}`)], { type: 'application/pdf' })
    },

    async urlsFotos(paths) {
      exigirAdmin()
      const r: Record<string, string> = {}
      for (const p of new Set(paths)) {
        r[p] = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ccc"/><text x="6" y="48" font-size="9">${p.split('/').pop()}</text></svg>`)}`
      }
      return r
    },
  }
}
