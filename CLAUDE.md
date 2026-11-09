# Instruções para o Claude Code

## Modelos

- **Opus 5.5:** planejamento, decisões de arquitetura, revisão de resultados e tarefas complexas.
- **Sonnet 5.5 ou Haiku 5.5:** tarefas simples ou braçais, como testes de rotina, documentação, ajustes repetitivos e conferências mecânicas. Ao delegar para um subagente, definir o modelo explicitamente.
- **Economia de contexto:** quando uma tarefa for autocontida (implementar um script, escrever testes, pesquisar no código, gerar documentação), iniciar um subagente com contexto limpo e um prompt completo — objetivo, arquivos envolvidos, restrições e critério de pronto —, em vez de executar tudo na conversa principal. A conversa principal fica com o planejamento, as decisões e a revisão do resultado.

## Decisões com o usuário

- Sempre que houver definições para o usuário tomar, apresentá-las com a ferramenta de perguntas (opções clicáveis), com a sugestão como primeira opção marcada "(Recomendado)". Cada pergunta deve se explicar sozinha; usar prévia quando ajudar a comparar. Explicações longas não substituem as opções.

## Projeto

- Textos, commits e documentação em português do Brasil.
- Plano de implementação: `tasks/plano-app.md`; checklist: `tasks/todo.md`. O visualizador do modelo federado é a última fase.
- Originais em `DOCS HTO/` são apenas lidos; os IFCs não ficam no Git.
- Dados da HTO: `scripts/extrair_ambientes.py` e `scripts/gerar_plantas.py` (ver `scripts/README.md`).
