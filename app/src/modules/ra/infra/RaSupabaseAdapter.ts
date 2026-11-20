import type { SupabaseClient } from '@supabase/supabase-js'
import type { AmbienteRA } from '../../../admin/dados/tipos.ts'
import type { PlantaAdmin } from '../domain/planta.ts'
import type { QrAmbiente } from '../domain/tipos.ts'
import { erroDeColunaAusente, erroDeEsquemaAusente } from '../../../shared/infra/errosSupabase.ts'
import type { RaRepositorio } from '../application/ports/RaRepositorio.port.ts'

type Linha = Record<string, unknown>
type LinhaRA = Omit<AmbienteRA, 'planta'> & {
  planta: (Omit<PlantaAdmin, 'url'> & { imagem_path: string }) | null
}
type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

/**
 * Adaptador Supabase da RA. `rpcAdmin` traduz os erros das chamadas admin; o app do campo não
 * usa essas operações, então o padrão apenas repassa a mensagem.
 */
export function criarRaSupabase(cliente: SupabaseClient, rpcAdmin?: Rpc): RaRepositorio {
  const rpc: Rpc =
    rpcAdmin ??
    (async (nome, args) => {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw new Error(error.message)
      return data as never
    })
  return {
    async obterGeometria(obra, ambiente) {
      // Tabelas/colunas da RA podem não existir em bancos sem a migration correspondente.
      const comPagina = await cliente
        .from('ambiente_geometria')
        .select('contorno, contorno_pagina, y_piso, y_teto')
        .eq('ambiente_id', ambiente.id)
        .maybeSingle()
      let { data: g, error } = comPagina
      if (erroDeColunaAusente(error)) {
        const semPagina = await cliente
          .from('ambiente_geometria')
          .select('contorno, y_piso, y_teto')
          .eq('ambiente_id', ambiente.id)
          .maybeSingle()
        g = semPagina.data as typeof g
        error = semPagina.error
      }
      if (error) {
        if (erroDeEsquemaAusente(error)) return null
        throw new Error(error.message)
      }
      if (!g) return null
      const pagina = (g as Linha).contorno_pagina as [number, number][] | null | undefined
      const [qr, referencial, modelos] = await Promise.all([
        cliente.from('ambiente_qr').select('parede, distancia_m, altura_m, lado_m').eq('ambiente_id', ambiente.id).maybeSingle(),
        cliente.from('ra_referencial').select('sigla, coordenadas').eq('obra_id', obra.id).maybeSingle(),
        cliente.from('modelo').select('sigla, matriz').eq('obra_id', obra.id).not('matriz', 'is', null),
      ])
      if (qr.error && !erroDeEsquemaAusente(qr.error)) throw new Error(qr.error.message)
      if (referencial.error && !erroDeEsquemaAusente(referencial.error)) throw new Error(referencial.error.message)
      if (modelos.error && !erroDeEsquemaAusente(modelos.error)) throw new Error(modelos.error.message)
      const linhaQr = qr.data as Linha | null
      const linhaRef = referencial.data as Linha | null
      return {
        contorno: (g.contorno as [number, number][]).map(([x, z]) => [Number(x), Number(z)]),
        ...(Array.isArray(pagina) && pagina.length >= 3
          ? { contornoPagina: pagina.map(([x, y]) => [Number(x), Number(y)] as [number, number]) }
          : {}),
        yPiso: Number(g.y_piso),
        yTeto: Number(g.y_teto),
        qr: linhaQr
          ? {
              parede: Number(linhaQr.parede),
              distancia_m: Number(linhaQr.distancia_m),
              altura_m: Number(linhaQr.altura_m),
              lado_m: Number(linhaQr.lado_m),
            }
          : null,
        referencial: linhaRef
          ? { sigla: String(linhaRef.sigla), coordenadas: (linhaRef.coordenadas as number[]).map(Number) }
          : null,
        matrizes: Object.fromEntries(
          ((modelos.data ?? []) as Linha[]).map((m) => [String(m.sigla), (m.matriz as number[]).map(Number)]),
        ),
      }
    },

    async listarRA(obraId) {
      const lista = (await rpc<LinhaRA[] | null>('admin_listar_ra', { p_obra: obraId })) ?? []
      // Assina em lote as imagens das plantas; falha ou caminho ausente deixa `planta` nula.
      const caminhos = [...new Set(lista.map((a) => a.planta?.imagem_path).filter((c): c is string => !!c))]
      const urls: Record<string, string> = {}
      if (caminhos.length > 0) {
        try {
          const { data, error } = await cliente.storage.from('plantas').createSignedUrls(caminhos, 3600)
          if (error) throw error
          for (const x of data ?? []) if (x.path && x.signedUrl && !x.error) urls[x.path] = x.signedUrl
        } catch {
          /* sem URL, sem planta */
        }
      }
      return lista.map(({ planta: p, ...a }): AmbienteRA => {
        const url = p ? urls[p.imagem_path] : undefined
        return {
          ...a,
          y_piso: Number(a.y_piso),
          y_teto: Number(a.y_teto),
          contorno: a.contorno.map(([x, z]): [number, number] => [Number(x), Number(z)]),
          qr: a.qr
            ? {
                parede: Number(a.qr.parede),
                distancia_m: Number(a.qr.distancia_m),
                altura_m: Number(a.qr.altura_m),
                lado_m: Number(a.qr.lado_m),
              }
            : null,
          contorno_pagina: a.contorno_pagina?.map(([x, y]): [number, number] => [Number(x), Number(y)]) ?? null,
          planta:
            p && url
              ? {
                  url,
                  pagina_pt: [Number(p.pagina_pt[0]), Number(p.pagina_pt[1])],
                  recorte_pt: p.recorte_pt.map(Number) as [number, number, number, number],
                  largura: Number(p.largura),
                  altura: Number(p.altura),
                }
              : null,
        }
      })
    },

    async definirQr(ambienteId, qr: QrAmbiente) {
      await rpc('admin_definir_qr', {
        p_ambiente: ambienteId,
        p_parede: qr.parede,
        p_distancia_m: qr.distancia_m,
        p_altura_m: qr.altura_m,
        p_lado_m: qr.lado_m,
      })
    },

    async removerQr(ambienteId) {
      await rpc('admin_remover_qr', { p_ambiente: ambienteId })
    },
  }
}
