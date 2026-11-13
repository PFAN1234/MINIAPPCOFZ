/**
 * Prévia do boletim (função Node da Vercel): GET `?etapa=<slug>&data=AAAA-MM-DD` com
 * `Authorization: Bearer <JWT do admin>`. Devolve o PDF com a marca "PRÉVIA — sem número", sem
 * gravar nada. Usada pelo site de administração (seção Boletins da etapa).
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
