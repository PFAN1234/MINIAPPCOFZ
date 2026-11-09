# Execução — piloto HTO

## Prioridade atual — mockup do Mini App (2026-11-06)

Integração entre IFC e planta 2D pausada a pedido do usuário. Preservar o diagnóstico existente e priorizar o desenho das telas com base nas duas capturas do grupo da obra.

- [x] Inspecionar as duas capturas do Telegram adicionadas na raiz do projeto.
- [x] Gerar mockup visual: frentes da obra, ambientes HTO, histórico, novo registro, pendências e encerramento pelo gestor.
- [x] Salvar a proposta e o prompt utilizado no projeto em `docs/mockups/`.
- [x] Atualizar a tela HTO com a opção “Visualizar modelo federado”, antes da escolha de ambiente (`docs/mockups/mini-app-v2.png`).
- [x] Gerar a tela do modelo federado a partir da terceira captura, com controles de visualização e seleção de modelos (`docs/mockups/modelo-federado-v1.png`).
- [x] Demonstrar a entrada pelo Telegram, revisada conforme pedido: mensagem fixada no tópico Geral → botão Abrir Diário da obra → lista de obras → escolha da obra (`docs/mockups/entrada-telegram-v2.png`). A entrada direta HTO da versão 1 foi substituída.

Escopo desta proposta: escolha de ambiente por lista, sem depender da integração IFC/planta. Conteúdo de exemplo deve ser identificado como ilustrativo.

- [x] Gerar a transição HTO → modelo federado com as nove siglas da nova referência: ARQ, ELT, HID, ESG, DRE, PCI, VES, TLD e ANT (`docs/mockups/hto-modelo-federado-v1.png`).
- [x] Montar GIF curto com abertura pelo Geral e navegação por obras, HTO, modelo federado, histórico e novo registro: `docs/mockups/demo-mini-app.gif`, 27,05 s, 600 × 1080, 4,65 MB. Quadros decodificados e roteiro visual conferido.
- [x] Acrescentar Pendências e Encerrar pendência (telas 5 e 6 do mockup) à demonstração: `docs/mockups/demo-mini-app-v2.gif`, 35,65 s, 5,97 MB, nove etapas e 88 quadros verificados. Versão anterior preservada.

## 1. Diagnóstico dos arquivos

- [x] Inventariar as duas plantas PDF e os três IFCs.
- [x] Extrair textos/coordenadas e gerar previews das plantas.
- [x] Extrair hierarquia, unidades, matrizes e geometria dos espaços IFC.
- [ ] Concluir correspondência geométrica do ambiente piloto e documentar transformação entre disciplinas.
- [ ] Revisar relatório final e evidências produzidas.

Verificação: contagens conferidas nos arquivos, relatório distingue evidências de hipóteses, scripts e versões preservados. Dependências: nenhuma.

## 2. Preparação do ambiente piloto

- [ ] Implementar importação reproduzível, vínculos e transformação de federação validada.
- [ ] Gerar recorte com geometria real das disciplinas e metadados do ambiente.
- [ ] Verificar corte, eixos, unidades, escala e tamanho do download; falhas de conversão devem aparecer no relatório de importação.

Verificação: sobreposição visual e controle independente de coordenadas; recorte não contém ambientes vizinhos inteiros. Dependência: 1.

## 3. Navegação 2D → 3D

- [ ] Criar obra/pavimento/planta clicável e carregamento do ambiente sob demanda.
- [ ] Testar seleção, zoom, rotação 3D, voltar e recuperação de erro de download.
- [ ] Conferir pelo portal Maestri em viewport móvel; registrar evidências e limites da simulação.

Verificação: um fluxo completo com documentos reais, sem depender do carregamento integral do IFC. Dependência: 2.

## 4. Acesso pelo Telegram

- [ ] Implementar validação da identidade e participação por obra.
- [ ] Configurar bot de teste e abertura do Mini App sob HTTPS.
- [ ] Testar equipe/gestor e rejeição de acesso a outra obra.

Verificação: identidade adulterada/expirada é rejeitada, inclusive nos arquivos protegidos. Dependência: 3.

## 5. Foto e histórico por ambiente

- [ ] Capturar ou selecionar fotos, preencher legenda e tipo, salvar com autoria e ambiente.
- [ ] Consultar histórico e abrir fotos do registro.
- [ ] Testar câmera em Telegram real e interrupção do upload.

Verificação: salvar e reabrir um registro em cada tipo; nenhuma foto vinculada à obra errada. Dependência: 4.

## 6. Registros com sinal instável

- [ ] Persistir rascunhos/fotos em IndexedDB e exibir estado de sincronização.
- [ ] Retomar uploads com idempotência e tentativa manual.
- [ ] Testar offline, reabertura, quota excedida e troca de usuário.

Verificação: reenvio não duplica registros; rascunho só desaparece após confirmação do servidor. Dependência: 5.

## 7. Publicação e resolução

- [ ] Publicar no grupo via fila de saída, mantendo o histórico em falhas do Telegram.
- [ ] Permitir ao gestor encerrar pendência com nova foto.
- [ ] Testar erro de publicação, resposta ambígua, encerramento concorrente e permissão de equipe.

Verificação: um registro de serviço e uma pendência aberta/resolvida aparecem corretamente no histórico e no grupo de teste. Dependência: 6.

## 8. Piloto assistido

- [ ] Validar e cadastrar os demais ambientes dos dois pavimentos.
- [ ] Medir desempenho em aparelho representativo e corrigir limites encontrados.
- [ ] Exercitar backup/restauração e reversão de revisão de documentos.
- [ ] Registrar aceite do fluxo com a equipe da obra.

Dependência: 7. Tokens do bot, grupo real, hospedagem e aparelho de teste ainda não foram fornecidos/configurados.
