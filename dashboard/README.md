# Painel HTO

Painel local para acompanhar o desenvolvimento do piloto HTO, as evidências de validação e o consumo/custo de tokens dos agentes.

## Executar

```bash
python3 dashboard/serve.py
```

Abra **http://127.0.0.1:8787/**. Para outra porta:

```bash
python3 dashboard/serve.py --port 8788
```

O servidor lê os arquivos do projeto e as sessões locais a cada requisição. A página se atualiza sozinha a cada 15 segundos e pausa a atualização enquanto você edita um campo.

## O que é monitorado

- `tasks/plan.md` e `tasks/todo.md`: objetivo, prioridade atual, checklist e progresso.
- `artifacts/validation/**`: inspeções IFC, inventário dos PDFs, calibração, alinhamento, revisão de gates e scripts reproduzíveis.
- `docs/**`: documento de validação e mockups.
- **Codex**: rollouts em `~/.codex/sessions/**/rollout-*.jsonl`, filtrando o diretório deste projeto.
- **OpenCode**: banco local `~/.local/share/opencode/opencode.db`, filtrando sessões deste diretório.

## Custo de API

O painel calcula o **custo de tabela** por 1M tokens:

```text
custo = (entrada − cache) × tarifa_in
      + cache × tarifa_cache
      + saída × tarifa_out
```

- Os preços vêm do catálogo OpenCode (provider `opencode-go`/`opencode`) na data da coleta.
- O Codex registra o raciocínio dentro dos tokens de saída; no OpenCode o raciocínio é somado à saída para o cálculo.
- O valor **não é necessariamente a cobrança da assinatura**. Ele responde “quanto custaria pela API” com as tarifas públicas.
- `gpt-6.1-terra` não tinha entrada exata no catálogo; usa a tarifa de referência da família Terra e aparece com `*`.

## Tarefas planejadas

As estimativas ficam em `dashboard/estimates.json` e representam premissas de planejamento, não medições. No painel você pode:

- escolher o modelo de simulação;
- ajustar o cache esperado (0–95%);
- editar entrada/saída de cada tarefa planejada;
- mudar orçamento e câmbio USD → BRL.

Essas escolhas ficam no `localStorage` do navegador. “Restaurar premissas” volta ao padrão.

## Privacidade e escopo

- Servidor em `127.0.0.1`, somente leitura.
- O endpoint `/files/` só entrega arquivos dentro da raiz do projeto.
- O painel inclui IDs e mensagens resumidas de sessões locais; não exponha a porta publicamente sem revisar esses dados.
- A validação IFC/PDF é **candidata e exploratória**. O painel mostra os gates abertos em `artifacts/validation/ifc/registration-review.json`; não substitui aprovação humana, topográfica ou de engenharia.

## Estrutura

```text
dashboard/
├── index.html       interface
├── styles.css       tema e layout
├── app.js           renderização, gráficos e simulador
├── collect.py       coleta e normalização dos dados
├── serve.py         servidor HTTP local
├── estimates.json   premissas de tokens das tarefas planejadas
└── README.md
```
