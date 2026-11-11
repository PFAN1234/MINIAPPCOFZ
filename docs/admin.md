# Site de administração

Site web (`/admin/`) para cadastrar e editar as obras do Mini App no navegador do computador, sem terminal e sem chave secreta. Plano e fases em `tasks/plano-admin.md`; checklist em `tasks/todo.md` ("Site de administração"). Esta página descreve a **fase 1** (acesso, obras, pavimentos, configuração, admins e exportação) e a **fase 2** (planta em PDF, seção "Planta (fase 2)" no fim). O envio do IFC (modelo) chega na fase 3.

## Peças

| Peça | Onde |
| --- | --- |
| Migration | `supabase/migrations/20261111170000_admin.sql` |
| Edge Function | `supabase/functions/admin-sessao/` (README com as ações) |
| Botão no Mini App | `app/src/telas/Obras.tsx` (`souAdmin()`, `criarLinkAdmin()` no repositório) |
| Site | `app/admin.html` + `app/src/admin/` (entrada própria do Vite, servida em `/admin/`) |
| Dados iniciais | `supabase/seed/admin_config.sql` (gerado por `scripts/importar_config_obras.py`) e `supabase/seed/admins.sql` |
| Testes | `tests/db/test_admin.py`, `tests/test_importar_config_obras.py`, `supabase/functions/admin-sessao/*_test.ts`, `app/src/admin/AdminApp.test.tsx`, `app/src/telas/Obras.test.tsx`, `app/e2e/admin.spec.ts` |

## Quem é admin

Tabela `public.admin_app (usuario_id, criado_em, criado_por)`, independente das obras: admin cria e edita todas as obras e inclui ou remove outros admins (nunca o último). `privado.eh_admin()` confere o usuário da sessão; a RPC `sou_admin()` devolve o mesmo para o cliente. Os primeiros admins (Patrício Ferreira e Eduardo Lima) entram por `supabase/seed/admins.sql`, pelo `telegram_id`; a pessoa precisa ter aberto o Mini App ao menos uma vez (a linha em `usuario` nasce no primeiro login).

## Entrada no site

Duas formas, ambas terminando numa sessão Supabase normal do próprio admin (o mesmo `auth.uid()` do Mini App), guardada no navegador pelo supabase-js com a chave `miniappcofz-admin-auth` (separada da do Mini App).

### 1. Botão "Administração" no Mini App

```
Mini App (tela Obras; botão só aparece se sou_admin())
  │ POST admin-sessao {acao: "criar"}  + Authorization: Bearer <JWT do usuário>
  ▼
admin-sessao: auth.getUser(JWT) → token aleatório (32 bytes, base64url)
  │ RPC admin_entrada_criar(usuario, sha256(token))  ← recusa quem não é admin (42501 → 403)
  │ privado.admin_entrada guarda só o hash, expira em 2 min; apaga os expirados
  ▼
{url: "<ADMIN_URL>#entrar=<token>", expira_em}  → Telegram.WebApp.openLink(url) (fora do Telegram, window.open)
  ▼
Site /admin/: lê #entrar=, apaga o hash da URL (history.replaceState) e chama
  POST admin-sessao {acao: "trocar", token}
  │ RPC admin_entrada_consumir(sha256(token)): apaga a linha (uso único) e só devolve o usuário
  │ se o link não expirou e ele ainda é admin
  ▼
sessão (generateLink + verifyOtp, a mesma lógica do auth-telegram) → supabase.auth.setSession
```

O token em claro só existe na URL (no hash, que o navegador não envia ao servidor) e na resposta da função; o banco guarda o SHA-256 em hexadecimal. Link reutilizado, expirado ou desconhecido recebe a mesma resposta (`401`).

### 2. Telegram Login Widget

Sem link, o site mostra o botão oficial do Telegram (`https://telegram.org/js/telegram-widget.js?22`, `data-telegram-login` = `VITE_TELEGRAM_BOT`, `data-onauth`) e o texto "ou use o botão Administração no Mini App". O retorno do widget (`id`, `first_name`, `last_name`, `username`, `photo_url`, `auth_date`, `hash`) vai para `admin-sessao {acao: "widget", dados}`, que valida conforme a [documentação oficial](https://core.telegram.org/widgets/login#checking-authorization): data_check_string com os campos (menos `hash`) em ordem alfabética, chave = SHA-256 do token do bot, HMAC-SHA-256, comparação em tempo constante e `auth_date` de no máximo 24 h. Depois, `admin_por_telegram(id)`: o usuário precisa existir em `usuario` e ser admin; a função não cria usuário. Quem não é admin (ou não existe) recebe `403` genérico.

Sessão de quem não é admin (por exemplo, removido depois de entrar) mostra "Acesso negado" com o botão Sair; as RPCs recusam com 42501 de qualquer forma.

## RPCs

Todas `security definer`, `search_path = ''`, `execute` só para `authenticated` (as da função, só para `service_role`). As de admin chamam `privado.exigir_admin()`: 28000 sem sessão, 42501 para quem não é admin.

| RPC | O que faz |
| --- | --- |
| `sou_admin()` | `boolean` |
| `admin_listar_obras()` | obras com pavimentos (`jsonb`), ambientes ativos, `status` da configuração e data da última gravação |
| `admin_obter_obra(slug)` | `jsonb` com obra (inclui `telegram_vinculado`), pavimentos (com contagem de ambientes e plantas), configuração e quem gravou por último |
| `admin_salvar_obra(p)` | sem `id`: cria (slug `^[a-z0-9-]+$`, até 40; nome até 120; ordem); com `id`: edita nome e ordem. Slug diferente na edição: 22023. Slug repetido: 23505 |
| `admin_salvar_pavimentos(slug, p)` | `p` é a lista completa `[{codigo, nome, ordem}]`: inclui, atualiza nome e ordem pelo código e apaga os que ficaram fora, desde que não tenham ambientes nem plantas (senão 23503 com os códigos). Código `^[a-z0-9][a-z0-9-]*$`, até 30 |
| `admin_salvar_config(slug, config)` | grava `obra_config` (objeto; `status` em `aguardando_revisao_humana`/`revisado`; `nomes_fixos` e `categorias` texto → texto), com `atualizado_por = auth.uid()` |
| `admin_exportar_obra(slug)` | `jsonb` com `formato`, `versao`, obra, pavimentos, configuração, ambientes e plantas (com detalhes) |
| `admin_listar_admins()`, `admin_incluir_admin(usuario)`, `admin_remover_admin(usuario)` | incluir exige usuário em `usuario` (P0002); remover nunca tira o último (22023) |
| `admin_listar_usuarios()` | quem já entrou no Mini App, com `eh_admin`, para escolher um novo admin |
| `admin_entrada_criar(usuario, hash)` | **service_role**. Link de 2 min; 42501 se não for admin |
| `admin_entrada_consumir(hash)` | **service_role**. Uso único; devolve `usuario_id`, `email`, `nome`, `username` ou nada |
| `admin_por_telegram(telegram_id)` | **service_role**. Admin pelo id do Telegram (Login Widget) |

As tabelas `admin_app`, `obra_config` e `privado.admin_entrada` têm RLS ligada e nenhum grant para `anon`/`authenticated`: o cliente só chega a elas pelas RPCs. Como nas fases anteriores, o `service_role` não tem grant nas tabelas; só executa as três funções acima.

## Configuração da obra (`obra_config`)

`config` é o equivalente do `data/<slug>/obra.json` sem `slug` e `nome` (que ficam em `obra`) e com os pavimentos reduzidos a `codigo`, `pdf` e `pagina` (nome e ordem ficam na tabela `pavimento`, editada pelo site). Na fase 1 o site edita `status`, `nomes_fixos` (abreviações) e `categorias`; os demais campos (`revisao`, `prancha`, `renomear`, `ambientes_manuais`, `manter_codigo`, `revisao_humana`...) são mantidos como estão. HTO e COFZ entram por `supabase/seed/admin_config.sql`, gerado por:

```bash
python3 scripts/importar_config_obras.py              # todas as obras de data/
python3 scripts/importar_config_obras.py --verificar  # falha se o SQL estiver desatualizado
```

Os scripts Python continuam lendo o `obra.json`; o banco passa a ser a fonte quando a fase 2 levar o extrator para o navegador. Até lá, uma mudança feita no site não volta sozinha para o `obra.json` (use "Exportar JSON" para conferir).

## Site `/admin/`

- Telas: Obras (lista com nome, slug, pavimentos, ambientes ativos e status; "Nova obra"), Obra (nome e ordem, slug só leitura; pavimentos com código só na criação; configuração; "Exportar JSON"; aviso de que PDF e IFC chegam nas próximas fases) e Admins (incluir entre usuários existentes, remover com confirmação).
- Vercel: `app/vercel.json` reescreve `/admin` e `/admin/(.*)` para `/admin.html` antes da regra geral do Mini App. Em dev e preview, o plugin `siteAdmin` do `vite.config.ts`.
- Service worker do Mini App: não intercepta `/admin` nem os pedidos feitos por páginas de `/admin`; o precache (`precache-manifest.json`) fica sem `admin.html` e sem os arquivos que só a entrada `admin` usa.
- Desenvolvimento: `VITE_DADOS=fixture npm run dev` e abrir `/admin/` (HTO e COFZ em memória; `localStorage['fixture-admin'] = 'nao'` simula quem não é admin).

## Variáveis e configuração

| Onde | Variável | Valor |
| --- | --- | --- |
| Edge Function `admin-sessao` | `TELEGRAM_BOT_TOKEN` | token do bot (segredo; o mesmo do `auth-telegram`) |
| | `SUPABASE_SECRET_KEY` | chave secreta (segredo; alternativa `SUPABASE_SERVICE_ROLE_KEY`) |
| | `ALLOWED_ORIGINS` | origens CORS separadas por vírgula; precisa incluir o domínio do site (`https://miniappcofz.vercel.app`, que é o mesmo do Mini App, e o domínio de preview se for testar nele) |
| | `ADMIN_URL` | endereço do site, padrão `https://miniappcofz.vercel.app/admin/` |
| Vercel (app) | `VITE_TELEGRAM_BOT` | nome do bot, sem `@` (Login Widget); `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` já existentes |
| BotFather | `/setdomain` | escolher o bot e informar o domínio do site (`miniappcofz.vercel.app`); sem isso o widget mostra "Bot domain invalid" |
| `supabase/config.toml` | `[functions.admin-sessao] verify_jwt = false` | a função confere o JWT, o token e o widget por conta própria |

Segredos entram com `supabase secrets set` ou pelo painel, nunca em arquivo.

## Aplicar num projeto

1. Migration `20261111170000_admin.sql`.
2. Deploy da função: `supabase functions deploy admin-sessao` (com `verify_jwt = false`, já no `config.toml`), segredos acima e `ALLOWED_ORIGINS`/`ADMIN_URL`.
3. Seeds de dados: `supabase/seed/admin_config.sql` (depois de `hto.sql` e `cofz.sql`) e `supabase/seed/admins.sql` (depois de os admins terem entrado no Mini App). Ambos idempotentes.
4. Vercel: `VITE_TELEGRAM_BOT` e novo deploy do app (o `vercel.json` novo publica `/admin/`).
5. BotFather: `/setdomain` com o domínio do site.
6. Conferir: no Mini App, o botão "Administração" aparece só para os admins e abre o site já logado; no site, o Login Widget entra com um admin e recusa outra conta.

## Planta (fase 2)

O admin envia o PDF de arquitetura de um pavimento e publica a planta pelo navegador, com o mesmo resultado dos scripts `extrair_ambientes.py` + `gerar_plantas.py` + `gerar_seed.py` + `publicar_plantas.py` (que ficam como reserva; `scripts/README.md`). Nada de servidor novo: o PDF é lido com o pdf.js e as imagens são geradas num canvas, na aba do admin.

### Peças

| Peça | Onde |
| --- | --- |
| Migration | `supabase/migrations/20261112090000_admin_planta.sql` |
| Port do Python (módulos puros) | `app/src/admin/planta/`: `pdf.ts` e `spans.ts` (texto como o PyMuPDF), `metricasFonte.ts` (Ascent/Descent do FontDescriptor), `extrair.ts` (`extrair_ambientes.py`), `plantas.ts` (contas do `gerar_plantas.py`), `render.ts` (imagens, prova, WebP), `editor.ts` (edições → configuração), `publicar.ts` (envio + RPC) |
| pdf.js no navegador | `planta/carregarPdfJs.ts` (worker, fontes padrão e WASM servidos pelo Vite) e `planta/servicoNavegador.ts`, carregados sob demanda só pelo editor |
| Telas | `app/src/admin/telas/planta/` (`EditorPlanta.tsx`, `Recorte.tsx`, `Ambientes.tsx`, `NovaRevisao.tsx`, `PlantaObra.tsx`) |
| Testes | `app/src/admin/planta/*.test.ts` (paridade em `paridade.node.test.ts`), `app/src/admin/telas/planta/EditorPlanta.test.tsx`, `app/e2e/planta.spec.ts`, `tests/db/test_admin_planta.py` |

### Fluxo no site

Obra → "Planta de <pavimento>" (ou `/admin/obras/<slug>/planta`, que lista os pavimentos com a planta publicada e o último PDF). O editor, em `/admin/obras/<slug>/planta/<pavimento>`, tem cinco etapas; nada é gravado antes de "Publicar".

1. **Arquivo**: escolher o PDF (até 50 MB) ou "Reabrir o PDF guardado" (o da última publicação do pavimento, baixado do bucket `originais`); escolher a página; informar a revisão (vem do nome `...-R07.pdf` quando houver; nome e revisão diferentes bloqueiam). "Ler a página" extrai o texto.
2. **Recorte e máscaras**: a página inteira com o recorte do edifício (azul) e as máscaras (tracejado vermelho). Arrastar no desenho cria o recorte ou uma máscara (conforme a ferramenta), arrastar um retângulo o move e as alças dos cantos redimensionam; a tabela mostra os valores normalizados (0–1, como no `obra.json`), editáveis, com descrição e "Apagar". "Usar em todos os pavimentos" grava em `config.prancha`; desmarcado, só no pavimento (`config.pavimentos[i].prancha`).
3. **Ambientes**: tabela e planta recortada lado a lado. Renomear (nome operacional), categoria (select com as categorias do extrator), arrastar pino, "Remover pino N" (rótulo duplo), "Voltar pinos ao rótulo", "Incluir ambiente sem rótulo" (clicar na planta) e "Remover ambiente" (manuais). Os casos de `revisar` do extrator aparecem no topo e as linhas ficam marcadas; itens da configuração que não valem mais para a planta (renomear de outra área, `manter_codigo` antigo, pinos de um código que sumiu) são listados e ficam de fora ao publicar.
4. **Nova revisão**: diferenças contra o que está no banco (novos, removidos com sucessor sugerido, códigos mantidos, nome e área alterados, pino deslocado). "Confirmar: é o mesmo ambiente" grava `manter_codigo` (o novo herda o código e os registros); "Desfazer" tira.
5. **Prova e publicar**: a prova (visão geral com todos os pinos, para baixar em PNG) e "Publicar", com barra de progresso: envia o PDF para `originais`, gera e envia `planta.webp`, `planta-hd.webp` e um recorte por ambiente para `plantas` (upsert) e chama `admin_publicar_revisao`. Erro em qualquer passo para tudo antes da RPC (o banco não muda) e mostra a mensagem. Depois, "Marcar como revisado" grava `status: revisado` e `revisao_humana` na configuração.

A página da obra ganhou as seções "Planta (PDF)" e "Publicações da planta" (histórico: quando, pavimento, revisão, quem, PDF, número de ambientes e contagem de diferenças).

### Como as edições viram configuração

Tudo continua no formato do `obra.json`, em `obra_config.config`:

| Edição | Campo |
| --- | --- |
| Renomear ambiente rotulado | `renomear` (pavimento + nome na planta + área). Se o ambiente já existe no banco, `manter_codigo[<id novo calculado>] = <código atual>`: o código não muda. |
| Renomear ou mover ambiente sem rótulo | a entrada dele em `ambientes_manuais` |
| Categoria de ambiente rotulado | `categorias[<nome na planta>]` (vale para todos os rótulos com esse nome) |
| Arrastar ou remover pino | `marcadores_ajustados[<código>] = {revisao, marcadores}` (campo novo, só do site): vale só na revisão em que foi feito; numa revisão nova os pinos voltam a sair dos rótulos. A caixa do rótulo anda junto com o pino, para o recorte de detalhe acompanhar. |
| Incluir ambiente sem rótulo | `ambientes_manuais` |
| É o mesmo ambiente | `manter_codigo` |
| Publicação | `revisao`, `pavimentos[i]` (`pdf`, `pagina`, `revisao` e, se for o caso, `prancha`), `status: aguardando_revisao_humana` |

### Banco e Storage (`20261112090000_admin_planta.sql`)

| Peça | Regra |
| --- | --- |
| Bucket `originais` | Privado, 50 MB, só `application/pdf`. Caminho `<obra_id>/<revisao>/<pavimento>/<sha256>.pdf`. Políticas `originais_admin_select/insert/update`: só `privado.eh_admin()`, insert/update só no padrão do caminho e com obra existente. Sem delete. |
| Bucket `plantas` | A leitura dos participantes não muda (`plantas_select`). Novas `plantas_admin_select/insert/update`: admin grava (e lê, porque o upsert do Storage exige select) em `<obra_id>/...` de obra existente. Sem delete. |
| `publicacao_planta` | `id, obra_id, pavimento_id, revisao, publicado_por, publicado_em, pdf_path, pdf_sha256, pdf_nome, pagina, resumo` (diferenças e contagens). RLS ligada, sem grant: só pelas RPCs. |
| `admin_publicar_revisao(slug, p)` | Uma transação com o mesmo efeito do seed nos pavimentos enviados: upsert dos ambientes com `ativo = true` (na ordem da lista), `ativo = false` nos `ambientes_removidos` e em todo ambiente **dos pavimentos publicados** fora da lista (os outros pavimentos não mudam), ordem global renumerada (pavimento, depois a ordem dentro dele), planta de outra revisão do pavimento desativada, upsert de `planta` e `planta_detalhe` com os caminhos do contrato, uma linha em `publicacao_planta` por pavimento. Confere que o PDF e todas as imagens já estão no Storage (P0002), valida o payload (22023: pavimento desconhecido, revisão inválida, caminho do PDF diferente de `<obra_id>/<revisao>/<pavimento>/<sha256>.pdf`, ambiente sem detalhe ou sem pino, pino fora de 0–1, código repetido, código ao mesmo tempo na lista e nos removidos, pavimento sem ambientes, tamanhos não positivos) e, com `config`, grava `obra_config` (status volta para `aguardando_revisao_humana`) com trava otimista: `config_atualizada_em` tem de ser o carimbo atual, senão 40001 ("alterada por outra pessoa"). |
| `admin_editor_planta(slug)` | Obra, configuração (com o carimbo), pavimentos com a planta ativa e o último PDF guardado, e todos os ambientes (inclusive inativos). |
| `admin_listar_publicacoes(slug)` | Histórico, mais recente primeiro, com o nome de quem publicou. |

### Paridade com o Python

`app/src/admin/planta/paridade.node.test.ts` (Vitest em Node, pdf.js `legacy` e `@napi-rs/canvas`) lê os três PDFs com a configuração de `data/<slug>/obra.json` e confere contra os JSON gerados pelo PyMuPDF:

| | HTO (2 PDFs) | COFZ (1 PDF) | Tolerância |
| --- | --- | --- | --- |
| Ambientes (ids, nomes, categorias, áreas, pdf, revisão, nº de pinos, `revisar`) | 87 de 87 iguais | 19 de 19 iguais | exata |
| Pinos e caixas de rótulo (normalizado) | maior desvio 1·10⁻⁶ | 1·10⁻⁶ | 0,002 |
| Tamanho da página | igual (float32) | igual | exata |
| `recorte_pt` da planta e dos detalhes | maior desvio 0,001 pt | 0,002 pt | 0,5 pt |
| Largura/altura das imagens e escala | iguais | iguais | 1 px |
| `diferencas` e `ambientes_removidos` com a base = `ambientes.json` | iguais | iguais | exata |

Os desvios restantes são do arredondamento em 3 e 6 casas. Para chegar nisso:

- **Altura do texto.** O PyMuPDF usa o Ascent/Descent do `FontDescriptor` (ArialMT 1040/−325, Calibri 1026/−312); o pdf.js informa os da tabela `hhea` da fonte (0,905/−0,212). `metricasFonte.ts` lê os descritores direto dos bytes do PDF (inclusive em object streams compactados) e liga cada fonte do pdf.js pelo nome (`fontExtraProperties`). Sem descritor, vale a métrica do pdf.js, como no MuPDF.
- **Agrupamento em spans.** `spans.ts` refaz as regras do `stext-device` do MuPDF sobre os itens do pdf.js: mesma linha se a direção é a mesma, a linha de base está a menos de 0,8 × tamanho e o avanço fica abaixo de 0,8 × tamanho (espaço acima de 0,15); span novo quando muda fonte ou tamanho; caractere repetido no mesmo lugar ("negrito falso") ignorado; texto fora da página descartado.
- **Tamanho das imagens.** Mesmo arredondamento do pixmap do MuPDF (retângulo para fora), e o pixel 0 de cada imagem no mesmo lugar.

Diferença conhecida, sem efeito nos rótulos: o pdf.js troca os espaços reais por espaços sintéticos e descarta os das pontas de cada trecho. Nos spans que não são rótulo, isso muda o fim da caixa (espaço no fim) ou junta "CAU       A48586-1" de outro jeito. Nas três pranchas, 367 de 400, 413 de 453 e 407 de 445 spans saem com texto e caixa iguais (a 0,01 pt); todos os 106 pares nome/área usados pelo extrator saem iguais, na mesma ordem. As imagens não são comparadas pixel a pixel (renderizadores diferentes); o teste de renderização confere tamanho, desenho e máscara branca.

### WebP e pacote

As imagens saem do canvas em WebP (`toBlob('image/webp', 0,8)`; qualidade 80 como no Python). Quando o navegador não gera WebP (Safari devolve PNG), o encoder WASM `@jsquash/webp` entra no lugar; os bytes são conferidos (`RIFF....WEBP`) antes do envio. pdf.js, worker, fontes padrão, WASM, encoder e editor ficam só no pacote do admin: o manifesto de precache do Mini App não os inclui (teste em `e2e/admin.spec.ts`).

### Limitações

- Página com rotação e `UserUnit` seguem o viewport do pdf.js (as pranchas atuais não usam nenhum dos dois); PDFs com fontes CJK sem embutir não são suportados (o site não serve os CMaps do pdf.js).
- O processamento roda na aba: o HD (~4096 px) e um recorte por ambiente levam alguns segundos por pavimento no computador.
- `marcadores_ajustados` e `prancha`/`revisao` por pavimento são só do site; os scripts Python os ignoram.

### Aplicar num projeto

1. Migration `20261112090000_admin_planta.sql` (depois da `20261111170000_admin.sql`). Cria o bucket `originais` e as políticas; não mexe em dados.
2. Deploy do app (o editor está no pacote do `/admin/`). Nenhuma variável nova.
3. Conferir com um admin: enviar o PDF atual de um pavimento já publicado, ver "Nenhuma diferença" na etapa 4, publicar e conferir no Mini App e em "Publicações da planta".
