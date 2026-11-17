# Controle de acesso — contrato

Decisões de 2026-11-17, que ajustam `docs/contrato-acessos.md`:
- a tela "Acessos da equipe" passa a se chamar **Controle de acesso**;
- o botão **Gestão** sai do cartão da obra. Os pedidos e os participantes já ficam no Controle de acesso. As publicações com problema aparecem num aviso no cartão, e só quando houver alguma;
- o botão "Controle de acesso" fica embaixo do botão "Administração", com o mesmo desenho;
- o portal de administração, na aba **Pessoas**, ganha o mesmo controle.

## A. Banco (migration nova: `supabase/migrations/20261122090000_controle_acesso.sql`)

- `privado.pode_controlar_acesso() returns boolean` (`security definer`, `search_path = ''`, `stable`): `privado.eh_gestor_alguma() or privado.eh_admin()`. `revoke` de `public, anon` e `grant` a `authenticated`.
- Recriar `public.matriz_acessos()` e `public.definir_acesso(...)` a partir de `20261121090000_acessos_lista.sql`, com estas mudanças:
  - a checagem passa a ser `privado.pode_controlar_acesso()`. As mensagens de erro continuam as mesmas;
  - em `definir_acesso`, a opção `nenhum` também recusa os pedidos pendentes da pessoa nessa obra (`estado = 'recusada'`, `decidido_por = auth.uid()`, `decidido_em = now()`), mesmo quando ela não tem participação;
  - as outras regras ficam iguais: administrador do grupo, último gestor e aprovação ao liberar.
- Testes em `tests/db/test_acessos_lista.py`:
  - admin do portal sem participação vê a matriz e altera o acesso;
  - quem não é admin nem gestor recebe `42501`;
  - `nenhum` recusa o pedido pendente e a pessoa continua na matriz, com `pedidos` vazio.

## B. Mini App (`app/src`)

### B.1 Início (`telas/Obras.tsx`)
- O cartão da obra perde o botão "Gestão" (`BotaoGestao`).
- Para o gestor da obra que tiver publicações com problema (`usePublicacoesProblema(obra.id, true)` com pelo menos um item), o cartão mostra embaixo dos totais um link de alerta: "1 publicação com problema" ou "N publicações com problema". O link leva a `/obras/:slug/publicacoes`. Sem problema, nada aparece.
- O atalho "Acessos da equipe" (`LinkAcessosEquipe`) sai.
- Embaixo da seção "Administração" entra uma seção nova, `ControleAcesso`, com o mesmo desenho:
  - `<section className="administracao">`;
  - um `Link` com `className="botao"` para `/acessos`, com o texto "Controle de acesso" e, quando houver pedidos pendentes, o selo `atalho-selo atalho-selo-alerta` com o total de pedidos (soma de `pedidos.length` da matriz);
  - embaixo, `<p className="lista-sub">Escolha quais obras cada pessoa do grupo pode ver.</p>`;
  - aparece para quem é gestor de alguma obra **ou** admin (`useEhGestorAlguma()` ou `useSouAdmin().data === true`). A contagem usa `useMatrizAcessos()` e só é buscada nesse caso.
- Se o botão de Administração não aparece (quem não é admin), a seção do Controle de acesso aparece sozinha no mesmo lugar.

### B.2 Publicações com problema
- `telas/Gestao.tsx` vira `telas/Publicacoes.tsx`, com só a seção das publicações com problema:
  - título "Publicações com problema" e o nome da obra como subtítulo;
  - estado vazio "Nenhuma publicação com problema.";
  - quem não é gestor da obra vê o mesmo estado que a tela Gestão mostra hoje.
- Rotas no `App.tsx`:
  - `obras/:slug/publicacoes` abre a tela nova;
  - `obras/:slug/gestao` redireciona para ela (`<Navigate replace>`), para não quebrar links antigos.
- Apagar o que ficar sem uso: `Participantes` da Gestão, CSS `gestao-*` sem uso e testes da Gestão, que viram testes da tela nova.

### B.3 Tela `/acessos` (`telas/AcessosEquipe.tsx`)
- O título passa a ser "Controle de acesso".
- Quem é admin, mesmo sem ser gestor, também entra na tela.
- Pedido pendente numa obra em que a pessoa não tem acesso: nenhum dos três botões fica marcado, e "pediu" continua ao lado do nome da obra.
  - Tocar em "Sem acesso" chama `definirAcesso(..., 'nenhum')`, que recusa o pedido.
  - Tocar em "Equipe" ou "Gestor" libera o acesso e aprova o pedido.
- Fixture (`dados/fixture.ts`): `definirAcesso(..., 'nenhum')` também recusa o pedido pendente.
- Os links "Lista de acessos da equipe" (em `telas/Acessos.tsx`) passam a dizer "Controle de acesso".

### B.4 Testes
- Atualizar os testes das telas afetadas, em Obras, AcessosEquipe, Acessos e Publicações:
  - o cartão não tem "Gestão";
  - o aviso de publicações aparece só quando houver;
  - o botão "Controle de acesso" aparece para gestor e para admin, e não aparece para quem não é nenhum dos dois;
  - o selo de pedidos;
  - o pedido pendente fica sem botão marcado, e "Sem acesso" recusa o pedido;
  - a rota antiga redireciona.

## C. Portal de administração (`app/src/admin`), aba Pessoas

### C.1 Dados (`admin/dados`)
- Tipos:
  - `MatrizAcessosAdmin`, no mesmo formato do Mini App: `{ obras: {id, slug, nome}[]; pessoas: {id, nome, username, admin, vistoEm, acessos, pedidos}[] }`;
  - `PapelAcesso = 'nenhum' | 'equipe' | 'gestor'`.
- Repositório: `matrizAcessos()` e `definirAcesso(obraId, usuarioId, papel)`, implementados nas duas fontes:
  - Supabase: chama as RPCs `matriz_acessos` e `definir_acesso`;
  - fixture: aplica as mesmas regras de erro e de pedido do item A;
  - as obras e as pessoas da fixture são coerentes com as que a fixture do portal já tem.
- Hooks:
  - `useMatrizAcessos()`, com a chave `['admin', 'matriz-acessos']`;
  - `useDefinirAcesso()`, que no `onSettled` invalida a matriz e `['admin', 'pessoas']`.

### C.2 Tela `admin/telas/Pessoas.tsx`
- Texto de dica: "Quem já abriu o Mini App ou falou no grupo. Escolha o acesso de cada pessoa a cada obra; o nome de exibição é o que sai no boletim…", mantendo o resto do texto atual sobre o nome de exibição.
- A tabela troca a coluna "Obras" por **uma coluna por obra** da matriz, com o nome da obra no cabeçalho.
- Cada célula tem um `<select>` com "Sem acesso", "Equipe" e "Gestor" e `aria-label` "Acesso de <nome> em <obra>".
  - Com pedido pendente e sem acesso, o select mostra uma quarta opção, "Pediu acesso", desabilitada e selecionada.
  - Admin do grupo: o select fica fixo em "Gestor", desabilitado, com `title` "Administradores do grupo são gestores de todas as obras.". Na coluna Telegram aparece o selo "admin do grupo".
  - Ao trocar a opção, salva na hora. O select fica desabilitado até a resposta. Em caso de erro, volta ao valor anterior e mostra a mensagem com `Resultado`, embaixo da tabela ou na linha.
  - Na linha do próprio usuário, pede confirmação antes ("Alterar o seu próprio acesso?").
- Linhas: as pessoas de `usePessoas()`. Se alguma pessoa da matriz não estiver em `usePessoas()`, ela entra com o nome da matriz, sem o campo de nome de exibição.
  - Quem tem pedido pendente vem primeiro; depois, a ordem atual.
  - A busca atual continua valendo.
- Enquanto a matriz carrega ou se der erro, a coluna de nomes funciona normalmente e as colunas de acesso mostram o estado: carregando ou erro com "Tentar de novo".
- Testes em `Pessoas.test.tsx`:
  - as colunas por obra;
  - trocar o select chama `definirAcesso`;
  - o erro reverte;
  - o admin do grupo fica desabilitado;
  - o pedido pendente.

## D. Publicação (assistente)
1. Aplicar a migration pela API de gerenciamento e acertar a versão no registro.
2. Conferir `matriz_acessos` em produção como admin.
3. O app e o portal publicam pelo Vercel no merge.
