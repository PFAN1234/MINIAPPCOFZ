# Plano de implementação — Diário da obra (sem o modelo federado)

## Contexto

O repositório só tem mockups (`docs/mockups/mini-app-v2.png`, `entrada-telegram-v2.png`), o plano `tasks/plan.md` e o diagnóstico IFC/PDF. O usuário quer adiar o **visualizador do modelo federado** (e toda a integração IFC/planta clicável) para o fim e implementar antes o restante: entrada pelo Telegram, obras → pavimento → ambiente, histórico, novo registro com fotos, pendências, encerramento pelo gestor, modo sem conexão e publicação no tópico da obra.

Decisões confirmadas:
- **Stack:** Supabase (Postgres + RLS, Storage, Edge Functions) + frontend React/Vite/TypeScript na Vercel. Substitui FastAPI do `plan.md`.
- **Ambientes:** começar pela HTO, extraindo a lista dos dois PDFs de arquitetura (Térreo = DE017, 1º pavimento = DE018).
- **Publicação:** supergrupo CO-FZ com tópicos; cada obra mapeada para `chat_id` + `message_thread_id`.

## Estrutura nova do repositório

```
app/                      # Vite + React + TS (Vercel)
  src/telegram/           # wrapper de window.Telegram.WebApp (tema, BackButton, MainButton, initData)
  src/api/                # cliente Supabase + queries (TanStack Query)
  src/offline/            # IndexedDB (idb): rascunhos, fotos, fila de sync
  src/screens/            # Obras, Obra, Ambiente, NovoRegistro, Pendencias, EncerrarPendencia, Registros
supabase/
  migrations/             # schema, RLS, RPCs, bucket
  functions/auth-telegram/    # valida initData → sessão
  functions/bot-webhook/      # comandos do bot
  functions/publish-outbox/   # envia fila ao Telegram (pg_cron)
  seed/hto.sql            # gerado a partir de data/hto/ambientes.json
scripts/extrair_ambientes.py
data/hto/ambientes.json   # lista revisada por humano (fonte do seed)
```

## Fases

### 0. Fundação
- Criar projeto Supabase (dev) e projeto Vercel ligado a `app/`; variáveis só em env (token do bot e service key nunca no cliente/Git; `.env.example`).
- Scaffold Vite+React+TS, ESLint, Vitest; script `<script src="https://telegram.org/js/telegram-web-app.js">`.
- Corrigir testes Python existentes: adicionar `requirements-dev.txt` com `pytest` (hoje `tests/test_registration.py` falha por falta dele).
- CI (GitHub Actions): typecheck, lint, vitest, pytest, `supabase db lint`.

### 1. Dados da HTO a partir dos PDFs
- `scripts/extrair_ambientes.py`: lê `artifacts/validation/pdf/inventory.json` (já tem `text_spans` com `bbox`/`normalized_bbox` por página e `floor`). Parte de `room_labels` e pareia cada nome com o rótulo `A=xx m²` logo **abaixo** dele na planta, pela proximidade dos bbox (a ordem do texto extraído é a inversa da visual). Saída: `data/hto/ambientes.json` com `pavimento`, `nome_planta`, `nome_operacional` (ex.: `APTO. 101` → `Apto. 101`, `BHO 101` → `Banheiro 101`), `categoria` (apartamento, banheiro, área comum, serviço, externo), `area_m2`, `pdf`, `revisao` (R05), `bbox_normalizada` (guardada para a futura planta clicável).
- Sinalizar para revisão: duplicatas (`CIRC. SUL`, `Circulação` ×2), `A=Não incluso` (Jardim), `SHAFT`/rótulos sem área. Banheiros permanecem ambientes separados dos apartamentos.
- Esperado: ~45 ambientes no Térreo e ~50 no 1º pavimento. Revisão humana do JSON antes de gerar `supabase/seed/hto.sql`.
- **Localização na planta (sem IFC):** `scripts/gerar_plantas.py` (PyMuPDF, mesmo padrão de `artifacts/validation/pdf/reproduce/inspect_pdfs.py`) gera, por PDF e revisão, uma visão geral do pavimento recortada na área do edifício (WebP, ~2400 px) e um recorte de detalhe por ambiente (~1000 px). Cada ambiente ganha um **marcador** (`marcador_x`, `marcador_y` normalizados no centro do par nome+área), além de `planta_id` e `detalhe_path`; nova tabela `planta` (pavimento, revisão, PDF, sha256, imagem, recorte, dimensões). Imagens no bucket `plantas/` em `hto/<revisao>/<pavimento>/`. O script gera uma imagem de prova com todos os marcadores para a revisão humana; rótulos repetidos (CIRC. SUL) e ambientes sem rótulo são resolvidos nessa revisão. Marcador indica posição, não contorno; contornos ficam para a fase 9.
- Teste pytest do pareamento usando o próprio `inventory.json` (ex.: `APTO. 101` = 23,88 m², `SALÃO DE EVENTOS` = 158,59 m², `APTO. 211` = 20,58 m² no 1º pav.).

### 2. Schema, RLS e autenticação Telegram
Tabelas (migrations): `obra` (slug, nome, ordem, `telegram_chat_id`, `telegram_thread_id`), `usuario` (telegram_id único, nome, username), `participacao` (obra, usuário, papel `equipe|gestor`), `solicitacao_acesso`, `pavimento`, `ambiente`, `registro` (id **gerado no cliente** = chave de idempotência, obra, ambiente, tipo `servico|pendencia`, legenda obrigatória, autor, `capturado_em`, `recebido_em`, `situacao` `aberta|resolvida` para pendências), `foto` (registro ou encerramento, `storage_path`, dimensões, bytes), `encerramento` (1:1 com pendência, gestor, observação), `publicacao_telegram` (estado `pendente|enviando|publicado|incerto|falhou`, tentativas, `message_ids`, erro, próxima tentativa).
- RLS: leitura/escrita somente se existe `participacao` na obra; encerramento somente gestor. Bucket privado `fotos`, caminho `obra/<obra_id>/<registro_id>/<foto_id>.jpg`, política de storage pela obra do caminho; exibição por URL assinada.
- RPCs (`security definer`, validações explícitas): `concluir_registro(...)` — insere ou retorna o existente pelo id (idempotente), confere que fotos/ambiente/obra coincidem e que os objetos existem, enfileira `publicacao_telegram` na mesma transação. `encerrar_pendencia(...)` — exige gestor e pendência aberta (trata concorrência com `for update`), grava foto de comprovação e enfileira publicação.
- Edge Function `auth-telegram`: valida `initData` (HMAC-SHA256 com `WebAppData` + token do bot, `auth_date` ≤ 24 h), faz upsert de `usuario` e devolve sessão Supabase (JWT com `sub` = usuario.id, `role=authenticated`, expiração curta). Confirmar na fase 0 o modo de chaves JWT do projeto Supabase.
- Usuário sem participação vê "Solicitar acesso"; gestor aprova (fase 7).

### 3. Navegação (telas 1–3 do mockup)
- **Obras** (home): lista das obras permitidas, busca, "Últimos registros". Nenhuma obra pré-selecionada.
- **Obra (HTO):** abas Térreo / 1º pavimento, busca de ambiente, lista agrupada por categoria. O cartão "Visualizar modelo federado" fica **oculto** (feature flag) até a última fase.
- **Ambiente:** abas Histórico / Pendências, botão "Novo registro" e cartão **"Onde fica"** (recorte da planta com marcador pulsante; ao tocar, abre a planta do pavimento em tela cheia, ampliada e centrada no ambiente).
- **Aba "Planta" na obra**, ao lado da lista: `PlantaViewer` (`app/src/components/PlantaViewer.tsx`, imagem + marcadores em SVG + `react-zoom-pan-pinch`). Tocar no marcador abre o ambiente; a busca centraliza o ambiente; marcadores mostram a contagem de pendências abertas. Aviso fixo "Planta de arquitetura R05 · posição indicativa". Imagens da planta em Cache Storage para continuar visíveis sem sinal.
- Barra inferior Início / Registros / Pendências; `BackButton` do Telegram; tema do Telegram (`themeParams`).

### 4. Novo registro online (tela 4)
- Câmera (`<input type=file accept=image/* capture=environment>`) e galeria, várias fotos; compressão no cliente (canvas, lado maior 1920 px, JPEG ~0,8; remover EXIF de localização).
- Tipo Serviço/Pendência, legenda obrigatória. Fluxo: gerar `registro_id` → upload das fotos ao Storage → `concluir_registro`.
- Histórico mostra foto, legenda, tipo, autor, horário e estado de publicação.

### 5. Sinal instável
- IndexedDB (`idb`): rascunho + blobs gravados **antes** de mostrar "Salvo no aparelho · aguardando envio".
- Sincronização ao abrir o app, no evento `online` e por botão "Tentar agora"; uploads repetíveis (mesmo caminho, `upsert`) e RPC idempotente → sem duplicatas.
- Estados distintos: salvo no aparelho → salvo no servidor → publicado no tópico. `navigator.storage.persist()` / `estimate()` para detectar falta de espaço; erro de cota visível. Rascunhos isolados por usuário Telegram (troca de conta não envia em nome de outro).

### 6. Bot e publicação no tópico
- Criar bot de teste (BotFather) e Mini App com **Direct Link** (`t.me/<bot>/<app>`); mensagem fixada no tópico Geral com botão de URL "Abrir Diário da obra".
- `bot-webhook`: `/vincular_obra <slug>` executado por gestor dentro do tópico grava `chat_id`/`message_thread_id`; `/start` em privado explica o app.
- `publish-outbox` (pg_cron + pg_net, a cada minuto): `sendPhoto`/`sendMediaGroup` com obra, pavimento, ambiente, tipo, legenda, autor e link `startapp=registro_<id>` de retorno. Backoff exponencial; resposta ambígua → `incerto` (sem repetição automática), gestor reconcilia. Falha no Telegram nunca apaga o registro.
- Abertura por `startapp` navega direto ao registro.

### 7. Pendências e gestão (telas 5–6)
- Pendências da obra: abas Abertas/Resolvidas, filtro por ambiente; detalhe com foto original.
- Encerrar pendência (só gestor): foto de comprovação separada, observação, publica no tópico respondendo à mensagem original (`reply_parameters`).
- Tela de gestão mínima: aprovar/recusar solicitações de acesso, definir papel, ver publicações `falhou/incerto` e reenviar/marcar como publicada.
- Aba global "Registros" (filtro por obra/tipo).

### 8. Piloto assistido HTO
- Grupo de teste → grupo real; cadastrar equipe e gestores; testes em aparelho Android e iOS reais (câmera, permissões, WebView, rascunho após fechar, desempenho); backup do Postgres/Storage; registrar aceite da equipe.

### 9. (Último) Modelo federado e planta clicável
Retomar `tasks/todo.md` §1–3 e `docs/validacao-hto.md`: validar federação (pontos de controle TLD, Z), recortes GLB por ambiente, viewer Three.js, planta 2D usando as `bbox_normalizada` já guardadas na fase 1, e ligar o cartão "Visualizar modelo federado".

## Atualizações de documentação
- Reescrever `tasks/todo.md` com as fases acima (o modelo federado vai para o fim) e ajustar `tasks/plan.md` (stack Supabase/Vercel, tópicos do supergrupo).
- `README.md`: como rodar `app/` e `supabase/` localmente.

## Verificação
- **Unidade (Vitest):** validação de `initData` com vetor assinado por token de teste (válido, adulterado, expirado); compressão de imagem; máquina de estados da fila offline.
- **Banco (`supabase test db`/pgTAP):** RLS — usuário de outra obra não lê nem grava; equipe não encerra pendência; `concluir_registro` repetido não duplica; encerramento concorrente só um vence.
- **Python (pytest):** pareamento de ambientes do `inventory.json`; marcador de APTO. 101 dentro do apartamento e distinguível do de BHO 101; todo marcador dentro do recorte do edifício; tamanho da visão geral < ~1,5 MB e de cada recorte < ~250 KB.
- **Planta no app (Playwright):** aba Planta → tocar no marcador do Apto. 101 abre o ambiente certo; "Onde fica" abre a planta centrada; planta já vista carrega offline.
- **E2E (Playwright, Chromium pré-instalado):** `supabase start` local + `vite dev` com `window.Telegram.WebApp` simulado (initData assinado com token de teste) em viewport de celular: obras → HTO → ambiente → novo registro com foto → histórico; offline (`context.setOffline`) → reabrir → sincroniza sem duplicar; gestor encerra pendência.
- **Telegram real:** bot e grupo de teste, publicação no tópico correto, link de retorno, aparelho físico. Emulação não substitui esse teste.
