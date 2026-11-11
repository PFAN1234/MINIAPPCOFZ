# Plano: site de administração do Mini App

Decisões de 2026-11-11 com o usuário. Checklist em `tasks/todo.md` (seção "Site de administração").

## Objetivo

Cadastrar obras novas e editar as existentes sem terminal, sem chave secreta e sem editar JSON à mão: subir os PDFs de arquitetura e os IFC, ajustar recorte, nomes, categorias e pinos, conferir a prova e publicar.

## Decisões

| Tema | Decisão |
|---|---|
| Onde | Site web fora do Mini App, aberto no navegador do computador. Mesmo repositório e mesmo projeto Vercel: entrada própria do Vite (`app/admin.html`, servida em `/admin/`), com bibliotecas pesadas (pdf.js, web-ifc) só nesse pacote. |
| Quem | Novo perfil **admin do Mini App** (tabela própria, independente das obras). Admins criam e editam todas as obras e incluem/removem outros admins. Primeiros admins: Patrício Ferreira e Eduardo Lima. |
| Entrada | (1) Botão "Administração" na tela inicial do Mini App, visível só para admin: pede um link de uso único (2 min) e abre o site no navegador já com a sessão. (2) Login do Telegram (Telegram Login Widget) no próprio site, aceito só para admins; exige `/setdomain` no BotFather com o domínio do site. |
| Processamento | No navegador do admin: PDF com pdf.js (texto com posição e renderização), imagens WebP geradas no navegador, IFC → `.frag` com o `IfcImporter` da That Open em Web Worker. Sem servidor novo. |
| Fonte da configuração | Banco (Supabase): configuração da obra e histórico das publicações. Botão de exportação em JSON para backup. Os scripts Python ficam como reserva e como referência de conferência (testes de paridade com HTO e COFZ). |
| Escopo da 1ª versão | Completo: obra e pavimentos, envio de PDF e IFC, prova, renomear/categorizar ambientes, arrastar pinos, desenhar recorte e máscaras, confirmar nova revisão (renomeados e removidos) e publicar. Entregue em fases. |

## Arquitetura

```
Mini App (Telegram) ── botão Administração (só admin)
        │ POST admin-sessao {acao:"criar"} com o JWT do usuário → link /admin/#entrar=<token> (uso único, 2 min)
        ▼
Site /admin/ ── troca o token por sessão (admin-sessao {acao:"trocar"}) ou Telegram Login Widget ({acao:"widget"})
        │ sessão Supabase normal do usuário (RLS e RPCs checam privado.eh_admin())
        ├── obra, pavimentos, configuração ── RPCs admin_* (security definer)
        ├── PDF ── pdf.js no navegador → ambientes, pinos, imagens → upload em `plantas` + RPC admin_publicar_revisao (transação, mesmo efeito do seed)
        └── IFC ── IfcImporter em Web Worker → .frag → upload em `modelos` + RPC admin_registrar_modelo
```

- Gravação sempre pela sessão do admin: políticas de Storage de insert/update para admin nos buckets `plantas` e `modelos`; tabelas escritas só por RPCs `security definer` que verificam `privado.eh_admin()`.
- `admin_publicar_revisao(obra, payload jsonb)` reproduz o `gerar_seed.py`: upsert de ambientes com `ativo`, inativa os fora da lista, desativa a planta de outra revisão, grava planta e detalhes, em uma transação.
- Configuração da obra em `obra_config` (jsonb com o equivalente do `obra.json`), com `atualizado_por` e `atualizado_em`; cada publicação gera uma linha em `publicacao_planta` (quem, quando, revisão, resumo das diferenças).

## Fases

### Fase 1: acesso e cadastro básico (código pronto em 2026-11-11; falta aplicar no `miniappcofz-dev`)

Documentação: `docs/admin.md`.

1. [x] Migration `20261111170000_admin.sql`: `admin_app (usuario_id, criado_em, criado_por)`, `privado.eh_admin()`, RPC `sou_admin()`; `obra_config`; RPCs `admin_listar_obras`, `admin_obter_obra`, `admin_salvar_obra` (slug, nome, ordem), `admin_salvar_pavimentos` (código, nome, ordem), `admin_salvar_config` (nomes fixos, categorias, status…), `admin_exportar_obra`, `admin_listar_admins`, `admin_incluir_admin`, `admin_remover_admin` (não remove o último), `admin_listar_usuarios`. Tabela `privado.admin_entrada` (hash do token, usuário, expira_em) e, só para `service_role`, `admin_entrada_criar`, `admin_entrada_consumir` e `admin_por_telegram`.
2. [x] Edge Function `admin-sessao`: `criar` (JWT de admin → token aleatório, guarda só o hash, 2 min), `trocar` (token → sessão, apaga o token), `widget` (valida o hash do Telegram Login Widget com SHA-256 do token do bot e `auth_date` recente; só admin). A emissão de sessão do `auth-telegram` foi para `_shared/sessao.ts` (e o CORS para `_shared/http.ts`) sem mudar o comportamento dele.
3. [x] Mini App: botão "Administração" na tela de obras quando `sou_admin()`; abre o link com `Telegram.WebApp.openLink` (fora do Telegram, `window.open`).
4. [x] Site `/admin/`: entrar (token ou widget), lista de obras, criar/editar obra e pavimentos, abreviações e categorias, status, admins, exportar JSON. Layout para computador.
5. [ ] Seed dos primeiros admins (Patrício e Eduardo) no `miniappcofz-dev`: `supabase/seed/admins.sql` pronto, falta aplicar.
6. [x] Importar a configuração atual de HTO e COFZ (`data/<slug>/obra.json`) para `obra_config`: `scripts/importar_config_obras.py` gera `supabase/seed/admin_config.sql` (falta aplicar).

Decisões da implementação (2026-11-11):

| Tema | Decisão |
|---|---|
| Status da obra | Fica em `obra_config.config.status` (como no `obra.json`), não numa coluna de `obra`; `admin_salvar_obra` trata só slug, nome e ordem. |
| Conteúdo de `obra_config` | O `obra.json` sem `slug` e `nome` e com os pavimentos reduzidos a `codigo`, `pdf` e `pagina`: nome e ordem do pavimento têm uma fonte só, a tabela `pavimento`. Campos que o site ainda não edita (`prancha`, `renomear`, `ambientes_manuais`…) são preservados. |
| Criar ou editar obra | Sem `id` cria (slug novo; repetido dá 23505); com `id` edita nome e ordem. Assim um slug existente nunca é sobrescrito por engano. |
| Pavimentos | `admin_salvar_pavimentos` recebe a lista completa; o que ficar fora é apagado só se não tiver ambientes nem plantas (23503 com os códigos). O código identifica o pavimento e não muda; no site, o código só é editável em linha nova. |
| Funções do service_role | Em vez de grants nas tabelas, três RPCs `security definer` só para `service_role`, que já conferem admin, expiração e uso único no banco. `admin_entrada_consumir` e `admin_por_telegram` devolvem o e-mail do Auth, usado no `generateLink`. |
| Respostas da `admin-sessao` | `401` para token/widget inválido, expirado ou reutilizado; `403` para sem JWT, não admin e usuário inexistente (sem distinguir os dois). |
| Sessão do site | supabase-js com `persistSession` e chave própria (`miniappcofz-admin-auth`), `detectSessionInUrl: false`; o token do hash é lido e apagado da URL antes de o React montar e usado uma única vez. |
| Rotas do site | `/admin/`, `/admin/nova-obra`, `/admin/obras/<slug>`, `/admin/admins` (a criação não usa `/obras/nova` para não colidir com uma obra de slug `nova`). |
| Precache do Mini App | O manifesto exclui `admin.html` e o que só a entrada `admin` alcança (grafo do bundle); o service worker ignora `/admin` e os pedidos feitos por páginas de `/admin`. |
| Fixture | Usuário de teste é admin por padrão (botão visível no Mini App em modo fixture e site já logado); `localStorage['fixture-admin'] = 'nao'` simula quem não é. Nos testes unitários do Mini App, `criarRepositorioFixture()` continua sem admin. |

### Fase 2: planta (PDF) (código pronto em 2026-11-12; falta aplicar no `miniappcofz-dev`)

Documentação: `docs/admin.md`, "Planta (fase 2)".

1. [x] Porta para TypeScript (`app/src/admin/planta/`) de `extrair_ambientes.py` (pareamento nome ↔ `A=xx m²`, nomes fixos, numeração de repetidos, rótulos duplos, ambientes manuais, base anterior, `manter_codigo`, `diferencas`) e de `gerar_plantas.py` (recorte, máscaras, visão geral, HD, recortes por ambiente, prova).
2. [x] Testes de paridade: HTO e COFZ dão os mesmos ambientes, códigos e pinos (desvio de 1·10⁻⁶) e os mesmos recortes e tamanhos (0,002 pt, 0 px) que os JSON gerados pelo Python.
3. [x] Editor: desenhar recorte e máscaras sobre a prancha, arrastar pinos, renomear e categorizar, incluir ambiente sem rótulo, revisar repetidos; tela de nova revisão com novos, removidos, renomeados sugeridos (confirmar = `manter_codigo`).
4. [x] Publicar: PDF em `originais`, imagens em `plantas` e `admin_publicar_revisao`; histórico em `publicacao_planta`; status da obra (`aguardando_revisao_humana` → `revisado`).
5. [ ] Aplicar a migration `20261112090000_admin_planta.sql` no `miniappcofz-dev` e conferir com a COFZ (`tasks/todo.md`).

Decisões da implementação (2026-11-12):

| Tema | Decisão |
|---|---|
| Spans iguais aos do PyMuPDF | Itens do pdf.js reagrupados com as regras do MuPDF (linha, espaço, fonte, negrito falso, fora da página) e altura com o Ascent/Descent do `FontDescriptor`, lido dos bytes do PDF (o pdf.js usa o da tabela `hhea`, que difere). Paridade dos rótulos: exata; diferença conhecida só em espaços de outros textos. |
| Base da extração no site | O estado do banco no pavimento (ativos = lista, inativos = removidos), sem as `diferencas` gravadas: as diferenças mostradas e guardadas são sempre contra o que está publicado. |
| Publicação por pavimento | O payload aceita vários pavimentos, mas o editor publica um por vez. A RPC só inativa ambientes fora da lista nos pavimentos publicados e renumera a ordem global (pavimento, depois a ordem interna), como o seed da obra inteira. |
| Edições → configuração | No formato do `obra.json` (`renomear`, `categorias`, `ambientes_manuais`, `manter_codigo`). Renomear um ambiente já publicado grava `manter_codigo` automaticamente (o código não muda). Pinos arrastados/removidos: campo novo `marcadores_ajustados`, válido só na revisão em que foi feito. Recorte/máscaras: para todos os pavimentos (`prancha`) ou só para um (`pavimentos[i].prancha`). Entradas que não batem mais com a planta são ignoradas e listadas, em vez de travar como no script. |
| Integridade | A RPC confere no `storage.objects` que o PDF e todas as imagens já foram enviados; o editor envia tudo antes de chamá-la. Trava otimista na configuração (`config_atualizada_em`, 40001). Publicar volta o status para `aguardando_revisao_humana`; "Marcar como revisado" grava `revisao_humana` da revisão publicada. |
| PDF guardado | Bucket privado `originais`, `<obra_id>/<revisao>/<pavimento>/<sha256>.pdf`, só admin (select/insert/update). O editor reabre o da última publicação do pavimento. |
| Storage `plantas` | Admin ganha select/insert/update nas pastas de obras existentes (o upsert exige os três); a leitura dos participantes não muda. |
| pdf.js no navegador | `pdfjs-dist` 6.4.299 (versão exata); worker, fontes padrão e WASM emitidos pelo Vite e servidos pelo site; carregado sob demanda pelo editor. WebP pelo canvas, com `@jsquash/webp` 1.5.0 (WASM) quando o navegador não gera WebP. Nada disso entra no precache do Mini App. |
| Testes | Paridade e renderização em Node (`*.node.test.ts`, pdf.js legacy + `@napi-rs/canvas` 1.1.0, tsconfig próprio); telas com um serviço de PDF falso; e2e com o PDF real da COFZ no Chromium. |

### Fase 3: modelo (IFC)
1. Conversão no navegador em Web Worker, com barra de progresso e aviso de memória; opção de enviar um `.frag` já convertido (pelo script Node) quando o IFC for grande demais.
2. Upload para `modelos` e `admin_registrar_modelo` (sigla, revisão, bytes, hash).
3. Limite de 50 MB por arquivo no Supabase grátis: validar antes de enviar.

## Riscos

| Risco | Mitigação |
|---|---|
| pdf.js agrupa o texto de outro jeito que o PyMuPDF e muda o pareamento. | Montar spans por proximidade como o `inspect_pdfs.py`; testes de paridade com HTO e COFZ antes de liberar. |
| WebP: Safari não gera WebP pelo canvas. | Encoder WASM (`@jsquash/webp`) ou exigir Chrome/Edge no site de admin. |
| IFC grande estoura a memória da aba (limite do WASM ~4 GB). | Web Worker, aviso de tamanho e envio de `.frag` pronto como alternativa. |
| Link de entrada vazado. | Uso único, 2 min, só o hash no banco, só para admin; a sessão é a do próprio admin. |
| Login Widget aceito para qualquer usuário do Telegram. | A função só abre sessão para quem está em `admin_app`. |
| Admin apaga dado em uso. | Nada é apagado: ambientes viram inativos, plantas antigas ficam como histórico; exclusão de obra fica fora do escopo. |
