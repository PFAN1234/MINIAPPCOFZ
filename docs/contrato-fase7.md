# Fase 7 — contrato de pendências, encerramento, gestão e telas restantes do mockup

Especificação para completar as telas do mockup (`docs/mockups/mini-app-v2.png` e `hto-modelo-federado-v1.png`), exceto o visualizador do modelo federado, que fica para a fase 9 (o botão já entra agora). Base: fases 2 a 6 (`docs/esquema-fase2.md`, `docs/contrato-fase3.md` a `docs/contrato-fase6.md`).

Pedido do usuário (2026-11-10), depois do teste real da fase 6:
- a planta não abriu;
- não havia como abrir uma pendência e registrar a resolução;
- implementar todas as funcionalidades do mockup, deixando só o visualizador do modelo para depois, com o botão já no lugar.

A planta não abria porque o bucket `plantas` estava vazio: as imagens foram enviadas fora deste contrato, pela Edge Function `assinar-envio-plantas`.

## A. Banco (migration `supabase/migrations/20261111120000_fase7_gestao.sql`)

Mesmos princípios das fases anteriores:
- `security definer`, `set search_path = ''` e nomes qualificados;
- `execute` só para `authenticated`;
- erros em português com os `errcode` da fase 2.

O encerramento já existe (`encerrar_pendencia`, fase 2) e a publicação do encerramento como resposta à mensagem original já existe (`publish-outbox`, fase 6).

- `listar_participantes(p_obra uuid) returns table (usuario_id uuid, nome text, username text, papel text, desde timestamptz)`:
  - só gestor (`42501`);
  - ordem: gestores primeiro, depois por nome.
- `definir_papel(p_obra uuid, p_usuario uuid, p_papel text) returns void`:
  - só gestor;
  - `p_papel in ('equipe','gestor')` (`22023`);
  - participação inexistente: `P0002`;
  - rebaixar o último gestor da obra: `22023` "A obra precisa de pelo menos um gestor.".
- `remover_participante(p_obra uuid, p_usuario uuid) returns void`:
  - só gestor;
  - mesma proteção do último gestor;
  - também apaga `privado.membro_grupo` do usuário na obra, para que ele precise pedir acesso de novo.
  - Observação: um admin do grupo volta a ser gestor no próximo login (fase 6). Isso fica documentado, não é bloqueado.
- `listar_publicacoes_problema(p_obra uuid) returns table (id bigint, estado text, erro text, tentativas int, atualizado_em timestamptz, registro_id uuid, encerramento_id uuid, tipo text, legenda text, ambiente text)`:
  - só gestor;
  - publicações `incerto` ou `falhou`, mais as `pendente` com `tentativas >= 3`;
  - ordem: mais recentes primeiro;
  - para encerramento, `registro_id` é o da pendência, `tipo = 'encerramento'` e `legenda` é a observação (ou "Pendência resolvida").
- `republicar(p_id bigint) returns void`:
  - só gestor da obra da publicação;
  - estado `incerto` ou `falhou` (senão `22023`);
  - volta para `pendente`, com `tentativas = 0`, `proxima_tentativa_em = now()`, `erro = null` e `atualizado_em = now()`;
  - o gatilho de disparo não roda em update, então chama `privado.disparar_publicacao()` no fim.
- `marcar_publicada(p_id bigint) returns void`:
  - só gestor;
  - estado `incerto` ou `falhou`;
  - vira `publicado`, com `erro = 'Marcada como publicada pelo gestor.'`.
- **Testes** em `tests/db/test_fase7.py`:
  - permissões (equipe e não participante recebem `42501`);
  - último gestor;
  - remoção apaga `membro_grupo`;
  - filtros de `listar_publicacoes_problema`;
  - `republicar` e `marcar_publicada` só a partir de `incerto`/`falhou`;
  - `republicar` enfileira `net.http_post` quando há segredos no stub.

## B. App

### B.1 Navegação e rotas novas
| Rota | Tela |
| --- | --- |
| `/obras/:slug/modelo` | Modelo federado (marcador de lugar) |
| `/obras/:slug/pendencias` | Pendências da obra (tela 5) |
| `/obras/:slug/pendencias/:id` | Detalhe da pendência e encerramento (tela 6) |
| `/obras/:slug/gestao` | Gestão da obra (só gestor) |

A barra inferior continua com Início, Registros e Pendências. "Pendências" na barra mostra as pendências de todas as obras do usuário, na mesma tela com o seletor de obra (B.4).

### B.2 Tela da obra (tela 2 do mockup)
- Topo: link "← Obras" e título com o nome da obra.
- Logo abaixo do título, cartão de largura total em azul claro:
  - ícone de cubo em SVG inline;
  - texto "Visualizar modelo federado";
  - chevron;
  - leva a `/obras/:slug/modelo`.
- Abaixo do cartão, atalhos em linha:
  - "Pendências" com o número de abertas, para `/obras/:slug/pendencias`;
  - só para gestor, "Gestão", com selo do total de pedidos de acesso pendentes mais publicações com problema, para `/obras/:slug/gestao`.

  O link "N pedido(s) de acesso" da fase 6 passa para dentro da Gestão; a rota `/obras/:slug/acessos` continua existindo, por causa do link do bot.
- O resto da tela continua igual: seção "Ambientes", pavimentos, busca, abas Lista/Planta.

### B.3 Modelo federado (marcador de lugar, fase 9)
- Topo: "← <obra>" e título "Modelo federado".
- Cartão informativo: "O visualizador 3D do modelo federado está em preparação e chega numa próxima versão."
- Lista "Modelos previstos", com chips desabilitados das disciplinas ARQ, ELT, HID, ESG, DRE, PCI, VES, TLD e ANT.
- Nada de 3D nem de IFC.

### B.4 Pendências (tela 5)
- Topo: "← <obra>" (só na rota da obra) e título "Pendências".
- Abas "Abertas" e "Resolvidas", com contagem.
- Filtro em `<select>`:
  - na rota da obra: "Todos os ambientes" e a lista de ambientes com pendências;
  - na aba global: "Todas as obras" e as obras.
  - O filtro fica na URL (`?aba=resolvidas&ambiente=<codigo>` ou `&obra=<slug>`).
- Card:
  - miniatura da primeira foto;
  - "<pavimento> · <ambiente>";
  - legenda, em até 2 linhas;
  - selo "Aberta" (laranja) ou "Resolvida" (verde);
  - data relativa;
  - chevron.
  - Toque leva ao detalhe.
- As pendências locais (fila, ainda não enviadas) aparecem no topo de "Abertas" com o estado local, sem link para o detalhe.
- `FiltroRegistros` ganha `ambienteCodigo?` e `obraSlug?`.

### B.5 Detalhe da pendência e encerramento (tela 6)
- Topo: "← <obra> / <pavimento>", título com o nome do ambiente.
- Legenda da pendência, com o selo "Aberta" ou "Resolvida".
- Foto original: a primeira grande e as demais em miniatura; toque abre o visualizador existente.
- Autor, data e estado de publicação.
- **Resolvida:** seção "Resolução" com:
  - fotos de comprovação;
  - observação;
  - "Encerrada por <gestor> · <data>";
  - estado de publicação do encerramento.
- **Aberta e gestor:** formulário.
  - "Comprovação da correção": seletor de fotos (Câmera/Galeria), de 1 a 10 fotos, reaproveitando o componente e a compressão do Novo registro.
  - "Observação": opcional, até 1000 caracteres, placeholder "Descreva a correção".
  - Nota "Acesso de gestor", com ícone.
  - Botão "Encerrar pendência", com confirmação.
- **Aberta e equipe:** nota "Só gestores da obra podem encerrar pendências." (Substituído em 2026-11-13: qualquer participante encerra; ver `tasks/todo.md`, "Encerrar pendência pela equipe".)
- **Envio pela fila offline** (mesma decisão da fase 5, "volta na hora"):
  - novo tipo de item na fila, `encerramento`, com `id` gerado no cliente, `registroId`, `obraId`, observação e fotos guardadas no IndexedDB;
  - o envio sobe as fotos para `<obra_id>/<registro_id>/<foto_id>.jpg` e chama `encerrar_pendencia(p_id, p_registro_id, p_observacao, p_fotos)`;
  - os erros seguem a classificação de `erros.ts`. `pendência já encerrada` (`23505`) é definitivo e aparece como "Esta pendência já foi encerrada.";
  - ao salvar, volta para a lista de pendências com o aviso "Encerramento salvo no aparelho";
  - enquanto houver um encerramento local da pendência, o detalhe mostra "Encerramento salvo no aparelho · aguardando envio" (ou o erro com "Tentar de novo"/"Descartar"), e o formulário some.
- O `Repositorio` ganha:
  - `obterPendencia(id): Promise<PendenciaDetalhe | null>`, com registro, fotos, ambiente, pavimento, obra, papel do usuário e encerramento (com fotos, gestor e publicação);
  - `encerrarPendencia(dados): Promise<{ id: string }>`.
- Nas listas de registros (histórico do ambiente, Registros, Início), um item de pendência leva ao detalhe. O toque na miniatura continua abrindo o visualizador.

### B.6 Registros (aba global)
- Filtros no topo:
  - obra (`<select>` "Todas as obras");
  - tipo, em botões segmentados: "Todos", "Serviços", "Pendências".
- Os filtros ficam na URL.
- Limite de 50 itens, mais o botão "Carregar mais" (+50).

### B.7 Gestão da obra (só gestor; equipe vê "Só gestores da obra têm acesso à gestão.")
- **"Pedidos de acesso":** a lista e as ações da tela Acessos da fase 6, reaproveitando o componente.
- **"Participantes":**
  - nome, @username e papel em `<select>` (Equipe/Gestor);
  - botão "Remover", com confirmação;
  - o erro do último gestor aparece inline.
- **"Publicações com problema":**
  - tipo, ambiente, legenda, estado ("Incerta: pode ter sido publicada" ou "Falhou") e erro;
  - botões "Reenviar" e "Marcar como publicada", com confirmação;
  - lista vazia: "Nenhuma publicação com problema.".
- O `Repositorio` ganha:
  - `listarParticipantes(obraId)`;
  - `definirPapel(obraId, usuarioId, papel)`;
  - `removerParticipante(obraId, usuarioId)`;
  - `listarPublicacoesProblema(obraId)`;
  - `republicar(id)`;
  - `marcarPublicada(id)`.

### B.8 Fixture
- A fixture cobre tudo isso com dados coerentes:
  - pendências abertas e resolvidas (pelo menos uma resolvida, com encerramento e foto de comprovação);
  - participantes: o próprio usuário como gestor, "Marcos Teixeira" e "João Lima" na equipe;
  - uma publicação `incerto` e uma `falhou`.
- O encerramento na fixture grava no localStorage (persistência existente).

### B.9 Testes
- **Vitest:**
  - tela de pendências (abas, filtro, item local);
  - detalhe (aberta como gestor, aberta como equipe, resolvida);
  - fila com o item `encerramento` (sucesso, falha transitória e conflito definitivo);
  - Registros com filtros;
  - Gestão (papel, último gestor, reenviar).
- **Playwright**, em viewport móvel com a fixture:
  - Obra → "Visualizar modelo federado" mostra o marcador de lugar;
  - Obra → Pendências → abrir pendência → encerrar com foto e observação → aparece em "Resolvidas";
  - o mesmo encerramento sem sinal fica na fila e é enviado ao voltar o sinal;
  - Gestão: mudar papel e reenviar publicação.
- Capturas das telas novas para conferência com o mockup.
