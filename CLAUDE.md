# Instruções para o Claude Code

## Modelos

- **Opus 5.5:** planejamento, decisões de arquitetura, revisão de resultados e tarefas complexas.
- **Sonnet 5.5 ou Haiku 5.5:** tarefas simples ou braçais, como testes de rotina, documentação, ajustes repetitivos e conferências mecânicas. Ao delegar para um subagente, definir o modelo explicitamente.

## Projeto

- Textos, commits e documentação em português do Brasil.
- Plano de implementação: `tasks/plano-app.md`; checklist: `tasks/todo.md`. O visualizador do modelo federado é a última fase.
- Originais em `DOCS HTO/` são apenas lidos; os IFCs não ficam no Git.
- Dados da HTO: `scripts/extrair_ambientes.py` e `scripts/gerar_plantas.py` (ver `scripts/README.md`).
