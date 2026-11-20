# Plano — Central de modelos (admin › Modelos)

Branch: `feature/admin-central-modelos`. Contrato (spec): `docs/contrato-central-modelos.md`.

Página nova no site de administração, depois de "Manutenção" no menu: um visualizador IFC (That Open Engine) em tema escuro, para administrar os modelos 3D, os documentos técnicos e as issues de cada obra. Referência visual: tela de "coordination set" com árvore à esquerda, canvas ao centro, barra de ferramentas no topo e barra de visibilidade embaixo.

## Decisões (2026-11-20)

| Tema | Decisão |
| --- | --- |
| Cena | **Uma obra por vez.** Uma lista com as obras que têm modelo ou documento; ao escolher, o canvas carrega todas as disciplinas da obra federadas. Trocar de obra libera a GPU antes de carregar a próxima. |
| Documentos | **Repositório novo + vínculo ao 3D.** Tabela e bucket próprios. O documento pertence a uma obra e, opcionalmente, a uma disciplina, a um pavimento e a elementos (GlobalId IFC). |
| Tipos de arquivo | PDF com prévia no painel (pdfjs, que o app já usa). DWG, DXF, XLSX, DOCX e imagens só para download. Até 100 MB por arquivo. Revisões com histórico. |
| Recursos 3D | Todos na v1: navegação e visibilidade, inspeção de propriedades, cortes e vistas (planta, elevações, orto/perspectiva, minimapa, caminhar), medições (distância, área, volume, ângulo) e issues/BCF. |
| Interface | Painéis em React próprio no tema do admin. 3D com `@thatopen/components` + `@thatopen/components-front` (sem `@thatopen/ui`). |
| Issues | Persistidas no Supabase (issue, comentário, vista com captura) e importação/exportação `.bcf`. |
| IFC original | **Não é guardado.** Só o `.frag` vai para o Storage, como hoje. (Ver risco R1.) |
| Gestão | **Tudo nesta página:** enviar IFC/`.frag`, publicar, retirar, histórico de modelos e documentos. A rota antiga `/obras/:slug/modelos` redireciona para cá. |
| Menu e tema | Item **"Modelos"** em `/modelos`. Tema escuro por padrão só nesta página, com botão para o claro (lembrado no navegador). |
| Acesso | Só admin na v1 (RLS por `privado.eh_admin()`). Coluna `visibilidade` já existe no documento para abrir aos participantes depois. |
| Entrega | **Um PR único** ao fim, com commits por etapa nesta branch. |

## Etapas (commits nesta branch)

Cada etapa é um ou mais `implementador` com escopo fechado (≤ 50 passos), revisado antes do commit. Ordem pensada para validar cedo o risco R1 (propriedades no `.frag`).

### 0 — Spike técnico (conversa principal + conferente)

1. Consultar a documentação atual (Context7) de `@thatopen/components` 3.6 e `@thatopen/components-front` 3.6: `Highlighter`, `Hider`, `Classifier`, `ItemsFinder`, `Clipper`, `Views`/plantas e elevações, medições (`LengthMeasurement`, `AreaMeasurement`, `VolumeMeasurement`, `AngleMeasurement`), `BCFTopics`/`Viewpoints`, `PostproductionRenderer` (contornos), minimapa e modo caminhar. Registrar nomes reais da API e o que não existe no v3.
2. Abrir o `.frag` do ARQ da HTO e conferir se traz atributos, property sets, estrutura espacial e GlobalId. Resultado decide R1.
3. Medir tamanho do chunk com `components-front` e a memória com todas as disciplinas carregadas.

Pronto: seção "Resultado do spike" preenchida neste arquivo; contrato ajustado se a API divergir.

### 1 — Página, tema e casca

Rota `/modelos` e `/modelos/:slug`, item no menu, redirect da rota antiga, layout em tela cheia (trilho lateral, painel esquerdo, canvas, painel de contexto), tokens de tema escuro/claro, lista de obras com contagens (RPC `admin_central_obras`). Visualizador em chunk `lazy`.

### 2 — Motor 3D e navegação

Porta `MotorVisualizador` + adaptador That Open (`infra/thatopen/`). Carregar as disciplinas da obra (reaproveitar `baixarModelo` e `cacheModelo`), barra "Carregando modelos…", enquadrar, eixos/view cube, contorno de arestas. Árvore espacial, categorias e modelos; busca; selecionar/destacar; ocultar, isolar, fantasma, mostrar tudo; colorir por categoria ou disciplina.

### 3 — Inspeção

Painel de propriedades do elemento selecionado (atributos, psets, quantidades), contagem por classe, busca por atributo (`ItemsFinder`).

### 4 — Cortes, vistas e medições

Planos de corte (criar, mover, inverter, apagar), plantas por pavimento, elevações N/S/L/O, orto/perspectiva, minimapa, modo caminhar. Medições de distância, área, volume e ângulo, com lista e exclusão (só na sessão; não persistem na v1).

### 5 — Gestão de modelos

Mover para esta página o envio de IFC/`.frag`, conversão no worker, publicação, retirada e histórico (hoje em `ModelosObra.tsx`), sem mudar as RPCs existentes. Recarregar a cena após publicar.

### 6 — Documentos

Migration (tabela `documento`, `documento_vinculo`, bucket `documentos`, RPCs), porta e adaptadores Supabase/fixture com contract test, painel de documentos (lista por disciplina/tipo, envio com revisão, prévia PDF, download, retirada, histórico), vínculo a pavimento e elementos a partir da seleção 3D, e "documentos deste elemento/pavimento" no painel de contexto.

### 7 — Issues e BCF

Migration (tabelas `issue`, `issue_vista`, `issue_comentario`, bucket `issues`, RPCs), painel de issues (lista, filtro por status, criar a partir da vista atual com captura, comentar, mudar status/responsável), marcadores no 3D, restaurar a vista da issue, importar/exportar `.bcf`.

### 8 — Fechamento

e2e Playwright, `docs/admin.md`, aplicar migrations em produção (API de gerenciamento, lendo do disco) e conferir RLS, suíte completa, PR.

## Riscos

| # | Risco | Plano B |
| --- | --- | --- |
| R1 | Os `.frag` já publicados não trazem propriedades/estrutura espacial suficientes, e o IFC original não é guardado. | Ajustar a configuração do `IfcImporter` (classes e relações) e republicar a partir dos IFC que estão fora da aplicação. A página mostra "Modelo sem propriedades — republique o IFC" quando faltar. |
| R2 | GlobalId muda entre revisões e o vínculo documento ↔ elemento se perde. | Vínculo guarda também classe e nome; ao publicar revisão, a página lista vínculos órfãos para revincular. |
| R3 | `components-front` 3.6 ausente, incompatível ou sem algum recurso (minimapa, caminhar, plantas). | Implementar o recurso faltante sobre `three`/`camera-controls` ou mover para fora da v1, registrado no spike. |
| R4 | Chunk grande / memória com todas as disciplinas. | Carregar disciplinas sob demanda (toggle desliga e descarrega); chunk só nesta rota; não entra no precache. |
| R5 | Escopo grande num PR único. | Commits por etapa, suíte verde a cada etapa, revisão do diff por etapa antes do commit. |
| R6 | jsdom sem WebGL. | Porta `MotorVisualizador` com dublê nos testes de componente; WebGL real só no e2e Chromium. |

## Resultado do spike

_(preencher na etapa 0)_
