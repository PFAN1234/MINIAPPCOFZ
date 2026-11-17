/**
 * Prévia do boletim (função Node da Vercel), com `Authorization: Bearer <JWT do admin>`:
 * GET `?etapa=<slug>&data=AAAA-MM-DD` (o dia como está no banco) ou POST `{boletim_id, edicao}`
 * (o boletim emitido com a edição aplicada, clima reaproveitado). Devolve o PDF com a marca
 * "PRÉVIA — sem número", sem gravar nada. Usada pelo site de administração.
 */
import { respostaDeErro, tratarPrevia } from '../servidor/boletim/http.js'
import { configuracaoDoAmbiente, criarAcessoAdmin, criarFonteSupabase } from '../servidor/boletim/supabase.js'

export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const config = configuracaoDoAmbiente()
      return await tratarPrevia(req, { fonte: criarFonteSupabase(config), acesso: (jwt) => criarAcessoAdmin(config, jwt) })
    } catch (e) {
      return respostaDeErro(e)
    }
  },
}
