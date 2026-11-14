# Manual de uso — Token-Saving Mods (Windows)

Pacote com 9 mods para o Claude Code que reduzem o gasto de tokens. Instalado em **escopo de usuário**: vale para todas as conversas do Claude Code (app e terminal).

> ⚠️ Os mods são carregados direto de `C:\Users\patri\Downloads\token-saving-mods`. **Não apague nem mova essa pasta**, senão eles param de funcionar.

---

## 1. Primeiros passos

1. **Ative os mods:** abra uma conversa nova (ou digite `/reload-plugins` numa conversa aberta).
2. **Confira:** digite `/mods`. Abre o painel que lista todos os mods, com um botão para ligar ou desligar cada um.
3. **Veja a economia:** digite `/savings`. Abre o painel com os tokens economizados hoje e nesta conversa.

Se um mod der problema, desligue só ele no `/mods`. Os outros continuam funcionando.

---

## 2. Referência rápida de comandos

| Comando | O que faz |
|---|---|
| `/mods` | Painel central: liga ou desliga cada mod e abre os painéis laterais |
| `/savings` | Painel de economia (`/savings sample` mostra dados de exemplo) |
| `/input-router` | Status do roteador de arquivos grandes |
| `/input-router full` | Deixa o **próximo** arquivo grande passar inteiro, uma vez |
| `/input-router pane` | Abre o painel com cada envio ao Haiku |
| `/input-router off file` · `on file` | Desliga ou religa a parte de arquivos nesta conversa (o mesmo vale para `connector`) |
| `/effort-optimizer` | Mostra o nível de esforço atual e o sugerido |
| `/effort-optimizer suggest` | Modo sugestão (padrão): mostra um botão **Switch** quando outro nível compensa |
| `/effort-optimizer auto` | Troca o nível de esforço sozinho |
| `/effort-optimizer off` · `on` | Desliga ou religa |
| `/model-router` | Status, faixas de modelo e economia; `/model-router pane` abre o painel |
| `/cacheclock` | Mostra ou esconde o relógio do cache; `/cacheclock hide` esconde |
| `/keepwarm` · `/keepwarm off` | Liga ou desliga o "manter cache quente" |
| `/fresh` | Mostra o painel **Refresh** (passar a conversa para um chat novo) |
| `/handoff` | Escreve o resumo de passagem (handoff) agora |
| `/research-router <pergunta>` | Pesquisa na web com um modelo barato e devolve um resumo com fontes |
| `/research-router deep <pergunta>` | Pesquisa profunda: divide a pergunta entre 2 a 4 subagentes |
| `/research-router pane` | Abre o painel de pesquisas |
| `/efficient-browser full` | Deixa a **próxima** captura de tela passar em tamanho original |
| `/efficient-browser shrink` · `describe` | Encolhe as capturas (padrão) ou faz o Haiku descrevê-las em texto |
| `/efficient-browser scale 0.5` · `min 512` | Ajusta a escala (0.2 a 0.9) e o tamanho mínimo em px (256 a 1568) |
| `/efficient-browser pane` | Abre o painel com as capturas encolhidas |

---

## 3. O que cada mod faz

### Input Router (automático)
Quando o Claude lê um **arquivo grande** (mais de ~2.000 tokens), um PDF com mais de 5 páginas, uma saída grande de `cat`/`grep`/`curl` ou um **resultado grande de conector** (MCP, mais de ~4.000 tokens), o **Haiku lê primeiro**. O Claude recebe notas curtas e o caminho do conteúdo completo.
- Não mexe em `CLAUDE.md`, `SKILL.md`, memórias, `settings.json`, nem em saídas de build, teste ou `git`.
- Trechos pequenos (menos de 100 linhas) passam exatos, para a edição continuar funcionando.
- Precisa do texto inteiro? `/input-router full` antes de pedir.
- Para ler PDFs, instale o **Poppler para Windows** e ponha a pasta `bin` dele no PATH.

### Effort Optimizer
Analisa cada prompt e escolhe o nível de esforço (raciocínio) necessário. No modo `suggest` aparece um botão **Switch** acima do campo de texto; no modo `auto` ele troca sozinho.

### Model Router (automático, só subagentes)
Quando o Claude cria um **subagente**, o Haiku avalia a tarefa e escolhe o modelo: **Haiku** para tarefas mecânicas, **Sonnet** para o trabalho normal e **Opus** para o que é difícil ou crítico. Só rebaixa com confiança ≥ 0,6. **Nunca muda o modelo da conversa principal.**
- Ajuste opcional das faixas e da confiança: `/plugin configure model-router@token-saving-mods`. Sem isso, ele usa os valores padrão.

### Cache Clock
Mostra uma **contagem regressiva** acima do prompt até o cache da conversa esfriar (5 min ou 1 h). Retomar depois que esfria sai mais caro, porque o contexto inteiro é reescrito.
- Numa conversa grande que esfriou, ele oferece um handoff para um chat novo.
- `/keepwarm` envia um "ping" pequeno em segundo plano ~45 s antes de esfriar, para manter o cache. Cada ping **custa um pouco** (lê o cache a 5–10% do preço). Para sozinho depois de 2 h, 30 pings ou quando você manda mensagem.

### Handoff (Refresh)
Quando a conversa passa de **250 mil tokens**, oferece **Refresh**: escreve um resumo completo da conversa e então copia para a área de transferência ou abre um chat novo com ele. Os registros ficam em `~/.claude/handoffs/`.

### Research Router
- **Automático:** encurta com o Haiku os resultados grandes de buscas na web que o próprio Claude faz.
- **Manual:** `/research-router como funciona X?` faz um modelo barato pesquisar, ler as páginas e devolver um resumo curto com as fontes, como mensagem nova. `deep` usa vários subagentes.
- Opcional: instale o Firecrawl CLI (`npm i -g firecrawl`) para ler páginas melhor.

### Efficient Browser Use (automático)
Toda captura de tela que o Claude tira no navegador é **reduzida pela metade** (mínimo de 512 px) antes de ir para o modelo. No Windows, PNG e JPEG são reduzidos; **WebP não**.

### Mods
O painel `/mods` encontra todos os mods do computador e liga ou desliga cada um em todas as conversas.

### Savings Proof
O painel `/savings` mostra o que cada mod economizou (hoje e nesta conversa), lendo o registro em `~/.claude/mods-logs/savings.jsonl`.

---

## 4. Onde ficam os arquivos

| O quê | Onde |
|---|---|
| Código dos mods | `C:\Users\patri\Downloads\token-saving-mods` |
| Logs e registro de economia | `C:\Users\patri\.claude\mods-logs\` |
| Handoffs | `C:\Users\patri\.claude\handoffs\` |

---

## 5. Atualizar ou desinstalar

**Atualizar** (quando vier um zip novo): descompacte por cima da pasta `token-saving-mods` em Downloads e então rode:
```
/plugin marketplace update token-saving-mods
/reload-plugins
```

**Desligar um mod:** use o painel `/mods`, ou `/plugin disable <nome>@token-saving-mods`.

**Desinstalar tudo:**
```
/plugin uninstall input-router@token-saving-mods
(repita para cada mod)
/plugin marketplace remove token-saving-mods
```

---

## 6. Observações

- O autor avisa que o pacote foi **feito para Windows, mas não foi testado num Windows**. Pode haver falhas; se algum mod travar, desligue no `/mods` e veja o log em `~/.claude/mods-logs/<mod>.log`.
- Os mods não usam chave de API própria: as chamadas ao Haiku saem da sua própria conta do Claude.
- Só o Research Router acessa a internet, e apenas quando você pede uma pesquisa.
