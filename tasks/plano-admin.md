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

### Fase 1: acesso e cadastro básico
1. Migration: `admin_app (usuario_id, criado_em, criado_por)`, `privado.eh_admin()`, RPC `sou_admin()`; `obra_config`; RPCs `admin_listar_obras`, `admin_salvar_obra` (slug, nome, ordem, status), `admin_salvar_pavimentos` (código, nome, ordem), `admin_salvar_config` (nomes fixos, categorias…), `admin_exportar_obra`, `admin_listar_admins`, `admin_incluir_admin`, `admin_remover_admin` (não remove o último). Tabela `privado.admin_entrada` (hash do token, usuário, expira_em) para os links de uso único.
2. Edge Function `admin-sessao`: `criar` (JWT de admin → token aleatório, guarda só o hash, 2 min), `trocar` (token → sessão, apaga o token), `widget` (valida o hash do Telegram Login Widget com SHA-256 do token do bot e `auth_date` recente; só admin). Reaproveita `abrirSessao` do `auth-telegram`.
3. Mini App: botão "Administração" na tela de obras quando `sou_admin()`; abre o link com `Telegram.WebApp.openLink`.
4. Site `/admin/`: entrar (token ou widget), lista de obras, criar/editar obra e pavimentos, abreviações e categorias, admins, exportar JSON. Layout para computador.
5. Seed dos primeiros admins (Patrício e Eduardo) no `miniappcofz-dev`.
6. Importar a configuração atual de HTO e COFZ (`data/<slug>/obra.json`) para `obra_config`.

### Fase 2: planta (PDF)
1. Porta para TypeScript de `extrair_ambientes.py` (pareamento nome ↔ `A=xx m²`, nomes fixos, numeração de repetidos, rótulos duplos, ambientes manuais, base anterior, `manter_codigo`, `diferencas`) e de `gerar_plantas.py` (recorte, máscaras, visão geral, HD, recortes por ambiente, prova).
2. Testes de paridade: HTO e COFZ devem dar os mesmos ambientes, códigos e pinos (tolerância pequena) que os JSON gerados pelo Python.
3. Editor: desenhar recorte e máscaras sobre a prancha, arrastar pinos, renomear e categorizar, incluir ambiente sem rótulo, revisar repetidos; tela de nova revisão com novos, removidos, renomeados sugeridos (confirmar = `manter_codigo`).
4. Publicar: upload das imagens e `admin_publicar_revisao`; status da obra (`aguardando_revisao_humana` → `revisado`).

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
