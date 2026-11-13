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

## Economia de tokens

A cota de uso é limitada e compartilhada entre a conversa principal e os subagentes. O objetivo é gastar menos sem baixar a qualidade do que é entregue: economizar em releitura, repetição e saída de comandos, nunca em revisão ou testes do que mudou.

### Subagentes

- Rodar um subagente pesado por vez. Dois em paralelo só quando as tarefas forem pequenas e independentes.
- Definir o modelo de cada subagente: Sonnet 5.5 para implementação guiada por contrato, testes e documentação; Haiku 5.5 para buscas e conferências mecânicas. Opus ou superior só para planejamento, arquitetura e revisão final.
- Dar a cada subagente um escopo fechado, que caiba em uma sessão curta: os arquivos que ele pode tocar, o trecho do contrato que vale para ele (copiado no prompt, em vez de mandar ler o documento inteiro) e o critério de pronto.
- Pedir que o relatório final seja curto: o que mudou, o que foi testado e com que resultado, e o que ficou em aberto. Sem colar código nem saídas longas.
- Se um subagente travar ou passar de três tentativas no mesmo erro, ele deve parar e relatar, em vez de continuar tentando.
- Subagente que falhar ou for interrompido (limite de uso, erro): não retomar o mesmo agente com todo o histórico. Abrir um novo, com contexto limpo e um resumo curto do que já está pronto (arquivos, commits) e do que falta.

### Leitura de arquivos

- Antes de abrir um arquivo grande, localizar o trecho com grep e ler só as linhas necessárias.
- Não reler um arquivo que já está no contexto e não mudou.
- Documentos longos (`docs/contrato-boletim.md`, `tasks/plano-boletim.md`, migrações) são consultados por seção, não inteiros.

### Comandos e testes

- Rodar testes em modo silencioso e filtrar a saída: só o resumo e as falhas (`-q`, `| tail`, `--reporter=dot`).
- Durante o desenvolvimento, rodar só os testes do que mudou. A suíte completa roda uma vez, antes do commit final.
- Não imprimir no contexto arquivos gerados, lockfiles, diffs grandes ou logs inteiros.

### Conversa

- Fechar as decisões com o usuário antes de começar a implementar; mudança de rumo no meio custa replanejamento e reescrita.
- Respostas curtas: o resultado, o que falta e a próxima decisão. Sem recapitular o que já foi dito.
- Ao terminar cada parte (PR e merge), registrar o estado em `tasks/todo.md` e pedir ao usuário que rode `/compact` (o Claude não consegue rodá-lo sozinho).
- Se a conversa passar de uma parte grande do trabalho sem compactar, avisar o usuário.
- Trocar de modelo (`/model`) só logo depois de um `/compact`: o cache é por modelo, e a troca obriga a regravar o contexto inteiro.

### O que não cortar

- Revisão do trabalho dos subagentes antes do commit.
- Testes do que foi alterado e a suíte completa antes do merge.
- Conferência do que foi aplicado no banco de produção.

### Banco e funções em produção

- Aplicar migrations e publicar Edge Functions pela linha de comando ou pela API de gerenciamento do Supabase (`api.supabase.com`), lendo os arquivos do disco, em vez das ferramentas que exigem o texto inteiro na conversa. O token de acesso fica como segredo de rede do ambiente; nunca no chat nem em arquivo.
