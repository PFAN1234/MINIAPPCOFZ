import type { RelatoriosRepositorio } from '@modules/relatorios/application/ports/RelatoriosRepositorio.port.ts'
import type {
  BoletimRelatorio,
  EtapaRelatorio,
  PainelRelatorios,
  Relatorios,
  ResultadoExclusaoBoletim,
} from '@modules/relatorios/domain/tipos.ts'
import { dataNoFuso } from '@shared/kernel/fuso.ts'
import { ErroEnvio } from '../../../dados/erros.ts'

export interface EtapaRelatorioSeed {
  id: string
  slug: string
  nome: string
  sigla: string | null
  horario: string
}

function boletimFixture(
  etapa: { id: string; slug: string; nome: string },
  data: string,
  revisao: number,
  emitidoEm: string,
): BoletimRelatorio {
  const numero = `${etapa.slug.slice(0, 2).toUpperCase()}-${data.replaceAll('-', '')}${revisao > 0 ? `-R${revisao}` : ''}`
  return {
    id: `boletim-${etapa.slug}-${data}-${revisao}`,
    etapa_id: etapa.id,
    etapa_slug: etapa.slug,
    etapa_nome: etapa.nome,
    data,
    revisao,
    numero,
    emitido_em: emitidoEm,
    pdf_path: `${etapa.id}/${data}-${revisao}.pdf`,
    publicado: true,
    ultima_revisao: true,
  }
}

/** Boletins de dias anteriores (o de hoje nasce na emissão); o de dois dias atrás da 2ª etapa tem retificação. */
function boletinsIniciais(dia: string, etapas: EtapaRelatorioSeed[]): BoletimRelatorio[] {
  const antes = (n: number) => dataNoFuso(new Date(new Date(`${dia}T12:00:00Z`).getTime() - n * 86_400_000), 'UTC')
  const [e2, e3] = etapas
  return [
    boletimFixture(e2, antes(1), 0, `${antes(1)}T21:00:00Z`),
    boletimFixture(e3, antes(1), 0, `${antes(1)}T20:30:00Z`),
    boletimFixture(e2, antes(2), 1, `${antes(2)}T22:10:00Z`),
    boletimFixture(e2, antes(2), 0, `${antes(2)}T21:00:00Z`),
  ]
}

/** Painel determinístico: ~5 semanas até `hoje`, 3 obras da 2ª etapa, pendências em parte resolvidas. */
export function painelFixture(
  hoje: string,
  etapa: { id: string; slug: string; nome: string } = {
    id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02',
    slug: '2a-etapa',
    nome: '2ª ETAPA',
  },
  obras = [
    { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01', slug: 'hto', nome: 'HTO' },
    { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02', slug: 'aurora', nome: 'Residencial Aurora' },
    { id: 'obra-quadra-fixture', slug: 'quadra', nome: 'Quadra Poliesportiva' },
  ],
): PainelRelatorios {
  const base = new Date(`${hoje}T12:00:00Z`).getTime()
  const dias: PainelRelatorios['dias'] = []
  const total = 35
  for (let i = total - 1; i >= 0; i--) {
    const d = new Date(base - i * 86_400_000)
    const dow = d.getUTCDay()
    if (dow === 0) continue // domingo sem movimento
    const dia = d.toISOString().slice(0, 10)
    const k = total - 1 - i
    obras.forEach((obra, o) => {
      if (dow === 6 && o !== 0) return
      if ((k + o) % 5 === 4) return // alguns dias sem movimento
      const servicos = 1 + ((k * 3 + o * 2) % 4)
      const pendencias = (k * 7 + o * 3) % 5 === 0 ? 2 : (k + o) % 3 === 0 ? 1 : 0
      const resolvidas = k > 6 && (k * 5 + o) % 4 === 0 ? 1 : 0
      if (servicos + pendencias + resolvidas > 0) {
        dias.push({ obra_id: obra.id, dia, servicos, pendencias, resolvidas })
      }
    })
  }
  return { etapa: { ...etapa, hoje }, obras, dias }
}

export interface DepsRelatoriosFixture {
  admin: boolean
  etapas: EtapaRelatorioSeed[]
  etapaPrincipalId: string
  hoje: () => string
  exigirRede: () => void
  atrasoExportacaoMs?: number
}

export function criarRelatoriosFixture(deps: DepsRelatoriosFixture): RelatoriosRepositorio {
  const { admin, etapas: etapasSeed, etapaPrincipalId, hoje, exigirRede, atrasoExportacaoMs = 800 } = deps
  const boletinsRel: BoletimRelatorio[] = boletinsIniciais(hoje(), etapasSeed)

  return {
    async relatorios(): Promise<Relatorios> {
      const dia = hoje()
      const etapas: EtapaRelatorio[] = etapasSeed.map((e) => {
        const ultimo = boletinsRel.find((b) => b.etapa_slug === e.slug && b.data === dia)
        return {
          ...e,
          hoje: dia,
          registros_hoje: e.slug === '2a-etapa' ? 4 : 0,
          boletim_hoje: ultimo
            ? { id: ultimo.id, numero: ultimo.numero, revisao: ultimo.revisao, emitido_em: ultimo.emitido_em }
            : null,
          pedido_hoje: null,
        }
      })
      const boletins = boletinsRel.map((b) => ({
        ...b,
        ultima_revisao: !boletinsRel.some(
          (o) => o.etapa_slug === b.etapa_slug && o.data === b.data && o.revisao > b.revisao,
        ),
      }))
      return { admin, etapas, boletins }
    },

    async painelRelatorios(etapaId): Promise<PainelRelatorios> {
      if (etapaId !== etapaPrincipalId) {
        return { etapa: { id: etapaId, slug: '', nome: '', hoje: hoje() }, obras: [], dias: [] }
      }
      return painelFixture(hoje())
    },

    async exportarPendencias() {
      if (atrasoExportacaoMs > 0) await new Promise((r) => setTimeout(r, atrasoExportacaoMs))
      return 'https://exemplo.invalid/relatorios/pendencias-exemplo.pdf'
    },

    async urlPdfBoletim(caminho) {
      return `https://exemplo.invalid/boletins/${caminho}`
    },

    async emitirBoletim(slug, data) {
      exigirRede()
      if (!admin) throw new ErroEnvio('permissao', 'Apenas admins do Mini App podem emitir boletins.')
      const etapa = etapasSeed.find((e) => e.slug === slug)
      if (!etapa) throw new ErroEnvio('nao_encontrado', 'Etapa não encontrada.')
      const doDia = boletinsRel.filter((b) => b.etapa_slug === slug && b.data === data)
      const revisao = doDia.length === 0 ? 0 : Math.max(...doDia.map((b) => b.revisao)) + 1
      boletinsRel.push(boletimFixture(etapa, data, revisao, new Date().toISOString()))
      boletinsRel.sort((a, b) => b.data.localeCompare(a.data) || b.revisao - a.revisao)
    },

    async excluirBoletim(id): Promise<ResultadoExclusaoBoletim> {
      exigirRede()
      if (!admin) throw new ErroEnvio('permissao', 'Apenas admins do Mini App podem excluir boletins.')
      const alvo = boletinsRel.find((b) => b.id === id)
      if (!alvo) throw new ErroEnvio('nao_encontrado', 'Boletim não encontrado.')
      const dia = boletinsRel.filter((b) => b.etapa_slug === alvo.etapa_slug && b.data === alvo.data)
      for (const b of dia) boletinsRel.splice(boletinsRel.indexOf(b), 1)
      return {
        numero: alvo.numero,
        data: alvo.data,
        revisoes: dia.length,
        mensagens: { apagadas: 1, falhas: 0 },
        arquivos_erro: null,
      }
    },
  }
}
