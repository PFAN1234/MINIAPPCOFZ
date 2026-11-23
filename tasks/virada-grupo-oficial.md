# Virada para o grupo oficial

Decisões (2026-11-23): apagar só os dados de uso; apagar no R2 os arquivos deles; manter o bot atual; mover a etapa `2a-etapa` do grupo de teste para o oficial.

## Estado conferido em produção (2026-11-23)

- Etapas: `2a-etapa` (grupo de teste `-1004435719187`) e `teste` (sem grupo).
- Obras: `hto` (tópico 2), `cofz` (40), `adm` (58) na `2a-etapa`; `teste` na etapa `teste`.
- Dados de uso: 10 registros, 18 fotos, 2 encerramentos, 25 publicações, 2 serviços, 10 boletins (+10 emissões), 2 observações, 3 linhas em `obra_excluida`.
- R2: 20 boletins, 18 fotos e 5 relatórios (cerca de 10 MB) a apagar. Plantas, modelos, original e logo ficam.

## 1. Reset do banco (Claude, pela API, numa transação)

Antes: exportar em JSON as linhas que serão apagadas (cópia para o usuário guardar fora do Git).

Apaga: `publicacao_telegram`, `foto`, `encerramento`, `registro`, `servico`, `boletim_rascunho`, `boletim_emissao`, `boletim`, `observacao`, `obra_excluida`, `erro_cliente`, `orfao_storage`.
Marca `excluir` em `arquivo` nas pastas `fotos`, `boletins` e `relatorios`; o job `manutencao-arquivos` (04:41 UTC) apaga no R2 e remove as linhas.

Fica: etapas, obras, pavimentos, ambientes, geometria, plantas, modelos, `obra_config`, RA/QR, responsáveis e aditivo da etapa, organização, usuários, participações, solicitações de acesso e admins.

Conferência: contagens zeradas, `arquivo` só com plantas/modelos/originais/organização depois do job, Mini App abre sem registros.

## 2. Grupo oficial (usuário, no Telegram)

1. O grupo oficial precisa ser **supergrupo com tópicos** ativados. Criar um tópico por obra (HTO, COFZ, ADM).
2. Adicionar o bot atual como **administrador**, com permissão para enviar mensagens, fixar mensagens e apagar mensagens (a retificação de boletim apaga a versão anterior).
3. No site `/admin/etapas/2a-etapa`: **Desvincular grupo** (limpa o grupo da etapa e os tópicos das obras).
4. No tópico Geral do grupo oficial: `/vincular_etapa 2a-etapa`.
5. Em cada tópico: `/vincular_obra hto`, `/vincular_obra cofz`, `/vincular_obra adm`.
6. No tópico Geral: `/fixar_botao`.
7. Tirar o bot do grupo de teste (opcional, evita comandos no grupo antigo).

Quem só estiver no grupo de teste deixa de ter acesso: o acesso às obras confere a participação no grupo da etapa.

## 3. Conferência final

- Abrir o Mini App pelo botão fixado; criar um registro com foto numa obra e conferir a postagem no tópico certo.
- Conferir no `/admin/` que a etapa mostra o grupo novo.
- Decidir o destino da etapa e obra `teste` (manter para testes ou excluir pelo site).
