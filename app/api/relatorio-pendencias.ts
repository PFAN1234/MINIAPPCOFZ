/**
 * Relatório de pendências em PDF (função Node da Vercel), com `Authorization: Bearer <JWT>`:
 * POST `{etapa_id, obra_id|null}`. Gera o PDF, grava em `relatorios/pendencias/<usuário>/...`
 * e responde `{url}` (URL assinada por 10 minutos). Usada pela tela Relatórios do Mini App.
 */
import { configuracaoDoAmbiente } from '../servidor/boletim/supabase.js'
import { respostaDeErroRelatorio, tratarRelatorio } from '../servidor/relatorio/http.js'
import { criarAcessoRelatorio, criarFonteRelatorio } from '../servidor/relatorio/supabase.js'

export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const config = configuracaoDoAmbiente()
      return await tratarRelatorio(req, { fonte: criarFonteRelatorio(config), acesso: (jwt) => criarAcessoRelatorio(config, jwt) })
    } catch (e) {
      return respostaDeErroRelatorio(e)
    }
  },
}
