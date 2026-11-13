/**
 * Gerador do boletim (função Node da Vercel): POST com `x-segredo-interno`, chamado pelo
 * `privado.disparar_gerador()` do banco (pg_cron e pedidos do site). Responde 202 e processa a
 * fila `boletim_emissao` em segundo plano. Contrato: docs/contrato-boletim.md, parte 3.
 */
import { waitUntil } from '@vercel/functions'
import { respostaDeErro, tratarGerar } from '../servidor/boletim/http.js'
import { configuracaoDoAmbiente, criarFonteSupabase } from '../servidor/boletim/supabase.js'

export default {
  async fetch(req: Request): Promise<Response> {
    try {
      return await tratarGerar(req, { fonte: criarFonteSupabase(configuracaoDoAmbiente()), aoFundo: waitUntil })
    } catch (e) {
      return respostaDeErro(e)
    }
  },
}
