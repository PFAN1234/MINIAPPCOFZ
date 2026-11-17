# Acessos por lista — contrato

Decisões de 2026-11-16:
- os gestores liberam o acesso numa lista de pessoas × obras, em vez de esperar um pedido;
- a lista vem de quem o bot conhece: quem abriu o app, quem entrou no grupo e quem mandou mensagem nele. O Telegram não deixa o bot listar todos os membros de um grupo;
- quem sai do grupo some da lista;
- "Solicitar acesso" e o aviso do pedido no tópico continuam como estão;
- **qualquer gestor** (de pelo menos uma obra não arquivada) altera o acesso de **qualquer obra**;
- cada célula da lista tem três opções: sem acesso, equipe ou gestor.

## A. Banco (migration nova: `supabase/migrations/20261121090000_acessos_lista.sql`)

### A.1 Coluna nova
- `privado.membro_grupo` ganha `admin boolean not null default false`, que indica se a pessoa é administradora do grupo.

### A.2 `sincronizar_acesso(p_usuario, p_itens)` (só `service_role`; recriar com a mesma assinatura)
Partir da versão mais recente, em `20261112180000_etapas.sql`.
- `admin`: igual a hoje e, além disso, grava `membro_grupo.admin = true`.
- `membro`: igual a hoje e, além disso, grava `membro_grupo.admin = false`.
- `visto` (novo): faz upsert de `membro_grupo` com `conferido_em = now()` e mantém o `admin` que já existe. Não mexe em participação nem em pedidos.
- `fora`: igual a hoje.

### A.3 Função auxiliar
- `privado.eh_gestor_alguma() returns boolean`: diz se `auth.uid()` tem participação `gestor` em alguma obra não arquivada.

### A.4 RPCs para `authenticated` (`security definer`, `search_path = ''`)

**`matriz_acessos() returns jsonb`**
- Exige login (`28000`) e `privado.eh_gestor_alguma()`. Sem isso, erro `42501` com "Só gestores veem a lista de acessos.".
- Formato: `{"obras":[{"id","slug","nome"}], "pessoas":[{"id","nome","username","admin","visto_em","acessos":{"<obra_id>":"equipe"|"gestor"},"pedidos":["<obra_id>"]}]}`.
- `obras`: as obras não arquivadas, na ordem `ordem`, `nome`.
- `pessoas`: cada usuário com `membro_grupo` ou `participacao` em alguma dessas obras, sem repetir.
  - `nome` = `coalesce(nome_exibicao, nome)`;
  - `admin` = `bool_or(membro_grupo.admin)`;
  - `visto_em` = `max(membro_grupo.conferido_em)`, ou `null`;
  - `acessos` traz só as obras em que a pessoa participa;
  - `pedidos` lista as obras com `solicitacao_acesso` pendente.
  - Ordem: quem tem pedido pendente primeiro, depois por nome e por id.

**`definir_acesso(p_obra uuid, p_usuario uuid, p_papel text) returns void`**
- Exige login (`28000`) e `privado.eh_gestor_alguma()` (`42501`, "Só gestores alteram acessos.").
- `p_papel` vale `nenhum`, `equipe` ou `gestor`; outro valor dá `22023` com "Acesso inválido.".
- Obra inexistente ou arquivada: `P0002`, "Obra não encontrada.".
- Pessoa com `membro_grupo.admin = true` nessa obra e `p_papel <> 'gestor'`: `22023`, "Administradores do grupo são gestores de todas as obras.".
- Trava os gestores da obra (`for update`), como `definir_papel`. Se a pessoa é o último gestor e passa para `equipe` ou `nenhum`: `22023`, "A obra precisa de pelo menos um gestor.".
- `nenhum`: apaga a participação. **Não** apaga `membro_grupo`, para a pessoa continuar na lista. Se não havia participação, não faz nada.
- `equipe` ou `gestor`:
  - faz upsert da participação com esse papel;
  - os pedidos pendentes da pessoa nessa obra passam a `aprovada`, com `decidido_por = auth.uid()` e `decidido_em = now()` (usar os nomes das colunas de `decidir_solicitacao`).
- Permissões: `revoke ... from public, anon` e `grant execute ... to authenticated`, para as duas RPCs.

### A.5 Testes de banco (`tests/db`, novo `test_acessos_lista.py`, no padrão dos existentes)
- `matriz_acessos`:
  - quem não é gestor recebe `42501`;
  - o formato do resultado;
  - obra arquivada não aparece;
  - pessoa só com `membro_grupo` aparece com `acessos` vazio;
  - `pedidos` e a ordem.
- `definir_acesso`:
  - gestor de outra obra libera esta;
  - `nenhum` mantém a pessoa na matriz;
  - aprova o pedido pendente;
  - admin não é rebaixado;
  - último gestor;
  - papel inválido;
  - obra arquivada.
- `sincronizar_acesso`:
  - `admin` e `membro` gravam a coluna `admin`;
  - `visto` não cria participação e mantém `admin`.

## B. Edge Functions

### B.1 `_shared/usuario.ts` (novo)
- Extrair do `auth-telegram` a parte que acha ou cria o usuário: `garantirUsuario(admin, tg, agora?) → id`.
  - Mesma lógica de hoje: busca por `telegram_id`; se não achar, faz `createUser` com o e-mail `tg<id>@telegram.invalid` e trata a corrida com `generateLink`; depois faz upsert de `usuario` com `nome` e `username`.
- O `auth-telegram` passa a usá-la, sem mudar o comportamento (os testes atuais continuam passando).

### B.2 `bot-webhook`
- Configuração: `allowed_updates: ["message", "chat_member"]`, o resto igual. Atualizar o teste.
- Grupos ligados a obras (`chat.id` igual a `obra.telegram_chat_id` de pelo menos uma obra não arquivada). Para todas essas obras do chat:
  - **Mensagem comum** (não comando) de pessoa (`from.is_bot = false`, sem `sender_chat`):
    - faz `garantirUsuario` e chama `sincronizar_acesso` com `visto`;
    - não responde nada no grupo;
    - para não ir ao banco a cada mensagem, guarda em memória os pares `chat:usuário` vistos na última hora (um `Map` no módulo basta).
  - **`message.new_chat_members`**: para cada pessoa que não é bot, `garantirUsuario` e `membro`.
  - **`message.left_chat_member`** (que não seja bot): se o usuário existe, `fora`. Não cria usuário.
  - **Update `chat_member`**: converte `new_chat_member` com a mesma regra do `auth-telegram`:
    - `creator` ou `administrator` → `admin`;
    - `member` → `membro`;
    - `restricted` → `membro` se `is_member`, senão `fora`;
    - `left` ou `kicked` → `fora`.
    - Se for `fora` e o usuário não existir, não faz nada. Nos outros casos, `garantirUsuario`.
- Comandos: tudo como hoje. Um comando também conta como `visto`.
- Erros: só no log, sem dados pessoais. A resposta continua sendo sempre `200`.
- Testes em `handler_test.ts`:
  - mensagem comum gera `visto`;
  - cache de uma hora;
  - entrada e saída pelos dois caminhos (`message` e `chat_member`);
  - chat sem obra é ignorado;
  - bot é ignorado.

## C. App (`app/`)

### C.1 Repositório (`dados/`)
- Tipos:
  - `MatrizAcessos = { obras: {id, slug, nome}[]; pessoas: PessoaAcesso[] }`;
  - `PessoaAcesso = { id, nome, username: string|null, admin: boolean, vistoEm: string|null, acessos: Record<string,'equipe'|'gestor'>, pedidos: string[] }`.
- Funções novas:
  - `matrizAcessos()`;
  - `definirAcesso(obraId, usuarioId, papel: 'nenhum'|'equipe'|'gestor')`.
- Implementar nas duas fontes: Supabase (RPCs) e fixture (dados de demonstração com 2 ou 3 obras e umas 4 pessoas, uma delas admin e uma com pedido pendente). Aplicar as mesmas regras de erro da RPC.
- Hooks novos em `hooks.ts`: `useMatrizAcessos()` e `useEhGestorAlguma()`. O segundo pode vir das obras do usuário que já estão carregadas, onde o papel é `gestor`.

### C.2 Tela `/acessos` (`telas/AcessosEquipe.tsx`)
- Título "Acessos da equipe" e o texto "Marque o acesso de cada pessoa às obras. A lista mostra quem já abriu o app ou falou no grupo.".
- Campo de busca por nome ou @username, quando houver mais de 6 pessoas.
- Um cartão por pessoa:
  - nome, @username e os selos "Admin do grupo" e "Pediu acesso";
  - uma linha por obra: o nome da obra e um seletor de três botões, "Sem acesso", "Equipe" e "Gestor".
    - Os botões usam `aria-pressed` e o grupo tem `role="group"`, com `aria-label` "Acesso de <nome> em <obra>".
    - Alvos de toque de pelo menos 44 px.
    - A obra com pedido pendente mostra "pediu" ao lado do nome.
- Admin do grupo: o seletor fica fixo em "Gestor", desabilitado, com a dica "Administradores do grupo são gestores de todas as obras.".
- Ao tocar numa opção, salva na hora:
  - o grupo fica ocupado até a resposta;
  - em caso de erro, volta ao valor anterior e mostra a mensagem (`role="alert"`) embaixo do cartão.
  - Na própria linha do usuário, pede confirmação antes de salvar ("Alterar o seu próprio acesso?").
- Estados:
  - carregando;
  - erro com o botão "Tentar de novo";
  - quem não é gestor vê "Só gestores veem a lista de acessos.";
  - sem pessoas: "Ninguém do grupo apareceu ainda. As pessoas aparecem aqui depois de abrir o app ou mandar uma mensagem no grupo.";
  - offline: "Sem conexão. Os acessos só podem ser alterados online.".
- Depois de salvar, invalidar as consultas que dependem de participação (obras, participantes e pedidos), do mesmo jeito que `decidir_solicitacao` faz hoje.

### C.3 Entradas
- Tela Obras (início): para quem é gestor de alguma obra, um link "Acessos da equipe" para `/acessos`. Seguir o estilo do link "N pedido(s) de acesso".
- Tela Gestão da obra e tela de pedidos (`/obras/:slug/acessos`): um link "Lista de acessos da equipe" para `/acessos`.
- Rota nova no `App.tsx`.

### C.4 Testes (Vitest + Testing Library, no padrão dos testes de tela atuais)
- A tela renderiza a matriz da fixture.
- Trocar para "Equipe" chama `definirAcesso` e atualiza o botão.
- Erro reverte e mostra a mensagem.
- Admin desabilitado.
- Confirmação na própria linha.
- Estados de quem não é gestor e de lista vazia.
- O link aparece só para gestor.

## D. Publicação (assistente)
1. Aplicar a migration pela API de gerenciamento.
2. Conferir `matriz_acessos` em produção.
3. Publicar `auth-telegram` e `bot-webhook`.
4. Rodar a ação `configurar` do `bot-webhook`, pelo `pg_net`, com `privado.segredo_interno()`, para o segredo não passar pela conversa.
5. Conferir no Telegram (usuário):
   - o bot precisa ser **administrador** do grupo para receber `chat_member` e as mensagens comuns;
   - uma pessoa nova que mandar mensagem no grupo aparece na lista.
