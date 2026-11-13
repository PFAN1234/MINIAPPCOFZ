# Plano — Realidade aumentada (RA) no registro de fotos

Objetivo: no ambiente, o fiscal abre a câmera pelo Mini App, vê o modelo de instalações elétricas sobreposto à imagem e registra fotos que comparam o executado com o modelado.

Entra depois da fase 9 de `tasks/plano-app.md` (modelo federado), porque depende da federação validada e do vínculo ambiente ↔ IfcSpace. O visualizador 3D (`tasks/plano-modelo-federado.md`) já está pronto e é reaproveitado.

## Decisões (2026-11-12)

- **Modelo:** IFC de elétrica (ELT) da HTO, fornecido pelo usuário. O trabalho de dados (RA1) começa quando o arquivo chegar; RA0 e a matemática do alinhamento não dependem dele.
- **Tipo de RA:** só a "RA parada", dentro do Telegram, igual em Android e iPhone. O fiscal fica num ponto e gira o celular; se andar, alinha de novo. Sem WebXR e sem abrir o Chrome.
- **Alinhamento:** dois métodos. Padrão: tocar em dois cantos do ambiente. Opcional: QR code fixado em posição conhecida.
- **Foto:** cada disparo gera duas fotos no registro, a limpa e a com o modelo por cima (2 das 10 do registro).

## O que a "RA parada" entrega e o que não entrega

- O celular sabe para onde está virado (giroscópio), mas não sabe que andou. O modelo fica no lugar enquanto o fiscal gira o aparelho sem sair do ponto. Um passo de 30 cm já desloca o desenho alguns centímetros em paredes próximas.
- Precisão esperada: da ordem de 5 a 15 cm em paredes a 2–4 m. Serve para ver se a caixa, o eletroduto ou o quadro está "onde o projeto diz", não para medir. A tela e a foto levam o aviso "posição indicativa", como a planta.
- Sem oclusão: o modelo é desenhado semitransparente por cima de tudo (inclusive do que estaria atrás de parede ou móvel). Há controle de opacidade.
- O navegador não informa o ângulo de visão da câmera. O app parte de um valor típico e o fiscal corrige no ajuste fino (ver RA2); o valor fica guardado por aparelho.

## Como funciona

```text
câmera (getUserMedia) ──► <video> em tela cheia
giroscópio/acelerômetro ─► orientação do aparelho ─┐
alinhamento (2 cantos ou QR) ─► posição + rumo ────┼─► câmera Three.js ─► canvas transparente sobre o vídeo
ELT.frag (cache por hash) + geometria do ambiente ─┘
disparo ─► quadro do vídeo (limpa) + quadro com o canvas (modelo) ─► Novo registro
```

### Tela

Rota `obras/:slug/ambientes/:codigo/ra`, aberta pelo botão "Comparar com o modelo (RA)" na tela do ambiente e no Novo registro. O botão só aparece quando o ambiente tem geometria e a obra tem o modelo ELT publicado. Carregada com `React.lazy`, no mesmo chunk do visualizador (Three e That Open fora do bundle inicial).

Controles: disparar, opacidade, ligar/desligar disciplinas (ELT; ARQ em contorno como referência), "Alinhar de novo", ajuste fino. O contorno do ambiente (arestas de piso, teto e cantos, vindas do IfcSpace) é desenhado junto: é ele que mostra ao fiscal se o alinhamento está bom.

### Orientação

Giroscópio em modo relativo, sem bússola: a armadura e os quadros desviam o magnetômetro. A gravidade dá a inclinação; o rumo vem do alinhamento. Fonte: `Telegram.WebApp.DeviceOrientation` (Bot API 8.0) e, onde faltar, o evento `deviceorientation` do navegador (no iPhone exige pedido de permissão). A escolha é fechada em RA0.

### Alinhamento por dois cantos (padrão)

1. O fiscal aponta para um canto do ambiente (encontro de duas paredes com o piso) e toca nele; o app mostra a planta do ambiente para ele dizer qual canto é. Repete para um segundo canto.
2. Conta: com a inclinação conhecida, cada toque vira uma direção; a interseção com o plano do piso dá dois pontos em escala da altura do celular. A distância real entre os cantos (do modelo) fixa a altura, e os dois pontos fixam posição e rumo.
3. Se o piso estiver encoberto, vale o mesmo com dois cantos do teto (usa o pé-direito do modelo).
4. Ajuste fino: arrastar gira o modelo, pinça corrige o ângulo de visão, até o contorno encaixar nas arestas reais. Um terceiro canto opcional confere o erro e avisa se passar do limite.

### Alinhamento por QR (opcional)

- Um QR impresso (A4, lado de ~18 cm) é fixado em ponto cadastrado do ambiente. Ele carrega o link `startapp` do ambiente: lido pela câmera do celular, já abre o Mini App nesse ambiente.
- Dentro da RA, o app acha os quatro cantos do QR no vídeo e calcula posição e rumo (pose de plano); a inclinação continua vindo da gravidade, que é mais estável que a do QR.
- Cadastro no site `/admin/`: página do ambiente → marcar na planta em que parede está o QR, a altura do centro e o tamanho; botão para gerar o PDF de impressão. Sem cadastro, o ambiente só oferece os dois cantos.
- Biblioteca de detecção decidida em RA0 (candidatas: `BarcodeDetector` nativo no Android, `jsQR`/`zxing` no iPhone). OpenCV.js fica de fora pelo tamanho.

### Foto

- Limpa: quadro do vídeo. Com modelo: o mesmo quadro com o canvas 3D composto por cima, mais uma faixa com ambiente, disciplina, revisão do modelo e "posição indicativa".
- As duas viram `File` e entram pelo caminho que já existe (`useFotosEscolhidas` → `prepararFoto` → fila offline → publicação no tópico). O limite de 10 fotos continua.
- Resolução: o vídeo entrega em geral 1920×1080, menos que a câmera nativa, mas igual ao teto de 1920 px que o app já aplica. No Android, tentar `ImageCapture.takePhoto()` para a foto limpa.
- Banco: `foto.origem` (`camera`, `galeria`, `ra_limpa`, `ra_modelo`) e `foto.ra` (jsonb: par da foto, sigla, revisão e hash do modelo, método de alinhamento, pose, erro do terceiro canto). Fica registrado contra qual revisão do modelo a comparação foi feita.

## Dados necessários (hoje não existem)

| Dado | Situação | Como obter |
| --- | --- | --- |
| IFC de elétrica da HTO | Não está no projeto | Usuário coloca em `DOCS HTO/IFC/`; converte com `npm run modelos` e publica pelo `/admin/` |
| ELT no mesmo referencial do ARQ | Desconhecido | Inventariar unidades e origem como foi feito para ANT/TLD (`docs/validacao-hto.md`); validar com pontos de controle; guardar a matriz por modelo |
| Vínculo ambiente ↔ IfcSpace | Só o Apto. 101 | Script: o pino do ambiente, levado ao IFC pela calibração PDF → IFC, cai dentro de um IfcSpace; conferir pela área; revisão humana dos que não baterem. O 1º pavimento precisa de calibração própria |
| Geometria do ambiente | Não existe | Do IfcSpace: contorno do piso, cota do piso acabado e pé-direito, no referencial do modelo; tabela `ambiente_geometria` |
| Posição dos QRs | Não existe | Cadastro no `/admin/` (RA4) |

Recorte: a v1 carrega o `ELT.frag` inteiro (já fica em cache por hash) e limita a exibição a uma caixa em volta do ambiente com 30 cm de margem, para pegar o que está embutido nas paredes e no forro. Recorte por ambiente em arquivos separados só se o celular não aguentar.

## Fases

### RA0 — Prova no aparelho real (antes de tudo)

Página de teste aberta dentro do Telegram, em um Android e um iPhone: câmera traseira por `getUserMedia` e o pedido de permissão; sensores (API do Telegram × evento do navegador) e deriva em 1 minuto; canvas WebGL sobre vídeo em tela cheia e quadros por segundo com o `ARQ.frag`; leitura de um QR a 1, 2 e 3 m; ângulo de visão medido.

Critério: câmera, sensores e sobreposição funcionam nos dois sistemas dentro do Telegram. Se a câmera não abrir no WebView de um deles, o plano B é abrir a RA no navegador do aparelho com link de uso único (mesmo padrão do `admin-sessao`), e essa decisão volta ao usuário.

### RA1 — Dados da HTO

ELT convertido e publicado; matriz ELT → ARQ validada; vínculo e geometria dos ambientes (piloto: Apto. 101 e mais três, depois os demais); migration de `ambiente_geometria`, `foto.origem` e `foto.ra`; `Repositorio.geometriaDoAmbiente` (fixture e Supabase).

Critério: no visualizador 3D, ELT e ARQ coincidem nos pontos de controle; pytest confere o contorno do Apto. 101 (6,03 × 3,96 m, 23,88 m²).

### RA2 — Tela de RA com dois cantos

Módulo `app/src/ra/`: `pose.ts` (conta do alinhamento, pura), `orientacao.ts` (sensores), `TelaRA.tsx` (vídeo, canvas, controles), ajuste fino, estados de erro (sem câmera, sem sensor, permissão negada, sem modelo).

Critério: Vitest recupera poses sintéticas com erro < 1 cm e < 0,5°, inclusive com ângulo de visão errado em 10% depois do ajuste; Playwright com câmera falsa do Chromium cobre a tela e os estados; no aparelho, o contorno encaixa no Apto. 101.

### RA3 — Fotos no registro

Disparo, composição, faixa de identificação, entrega ao Novo registro, fila offline, publicação e exibição do par no histórico (selo "RA" na miniatura).

Critério: e2e salva um registro com o par, as duas fotos chegam ao Storage com `origem` e `ra` certos e saem no álbum do tópico; funciona sem sinal com o modelo já em cache.

### RA4 — QR

Cadastro e PDF de impressão no `/admin/`, detecção e pose no app, QR como link de entrada do ambiente.

Critério: Vitest com imagens sintéticas do QR em poses conhecidas; no aparelho, alinhamento pelo QR a 2 m com erro comparável ao dos dois cantos.

### RA5 — Piloto em campo

Quatro ambientes da HTO, Android e iPhone: medir o erro em pontos conhecidos (caixas e quadro), tempo para alinhar, leitura sob pouca luz; ajustar limites e textos; documentar em `docs/ra.md` e treinar a equipe.

## Riscos

| Risco | Resposta |
| --- | --- |
| WebView do Telegram bloqueia câmera ou sensores em algum sistema | RA0 antes de qualquer outra fase; plano B com link de uso único para o navegador |
| Ângulo de visão desconhecido e distorção da lente | Ajuste fino com pinça, terceiro canto de conferência, valor guardado por aparelho |
| Fiscal anda e o modelo "escorrega" | Aviso na tela, botão "Alinhar de novo" sempre visível, detecção de passos pelo acelerômetro para sugerir novo alinhamento |
| Cantos encobertos (móveis, material estocado) | Cantos do teto; QR |
| Obra executada diferente do ARQ modelado (parede deslocada) | O contorno deixa a diferença visível; o alinhamento usa os cantos que o fiscal escolher |
| ELT em referencial diferente ou sem IfcSpace compatível | Validação em RA1 antes de qualquer tela; matriz por modelo |
| Deriva do giroscópio em sessões longas | Sessões curtas por natureza; realinhar leva poucos segundos |
| QR pequeno dá rumo impreciso à distância | A4, gravidade pelo sensor, aviso de "aproxime-se" quando o QR ocupa poucos pixels |
| Peso no celular (vídeo + 3D) | Só ELT e contorno por padrão; caixa de corte; medir em RA0 |

## Execução

Conversa principal (Opus 5.5): contratos de cada fase, a conta do alinhamento e as revisões. Subagentes com contexto limpo: página de teste do RA0, scripts de vínculo e geometria, testes e documentação (Sonnet 5.5 ou Haiku 5.5, modelo definido na delegação). Cada fase ganha um `docs/contrato-ra<n>.md` antes de começar, como nas fases anteriores.

## Andamento (2026-11-12)

Uso e aplicação em `docs/ra.md`; contrato em `docs/contrato-ra.md`.

- [x] RA0 (código): tela de teste do aparelho em `/ra-teste` (link `startapp=ra_teste`). Falta rodar em um Android e um iPhone dentro do Telegram.
- [x] RA1 (código e dados da arquitetura): referencial do `ARQ.frag` R06 ajustado ao inventário do IFC pelas faces das paredes (erro de 3 mm); `scripts/gerar_geometria.py` liga 86 dos 87 ambientes da HTO ao IfcSpace (fica de fora o Jardim 2, sem área na planta); calibração do 1º pavimento derivada por votação; migration `20261113090000_ra.sql` e `supabase/seed/hto_geometria.sql`. Falta: aplicar no banco e conferir o modelo de elétrica (o `.frag` publicado não pôde ser lido desta sessão).
- [x] RA2: `app/src/ra/` com alinhamento por dois cantos (piso, teto ou misto), ajuste fino e conferência do terceiro canto. A geometria fica no referencial do `ARQ.frag`, não em tabela por IfcSpace no app.
- [x] RA3: par de fotos no Novo registro, fila offline, `foto.origem`/`foto.ra` e selo "RA" no histórico. A publicação no tópico não mudou: as duas fotos saem no álbum.
- [x] RA4: cadastro e folha de impressão do QR em `/admin/obras/<slug>/ra`; leitura (`BarcodeDetector` ou `jsQR`) e pose no app; `startapp=amb_<slug>_<codigo>` abre o ambiente.
- [ ] RA5: piloto em campo. Primeiro teste (2026-11-13): difícil alinhar pelos cantos. Mudanças: mira fixa no centro e botão "Marcar canto" (o erro do ângulo de visão sai do alinhamento); planta real do pavimento enquadrada no cômodo, com os cantos numerados (`contorno_pagina`, migration `20261119090000_ra_contorno_pagina.sql`) na folha e numa miniatura; malha triangular do piso estimado antes de alinhar e de piso, paredes e teto do modelo depois (chip "Malha", fora da foto). Falta aplicar a migration e o seed novo da geometria no banco e repetir o teste em campo.

Mudanças em relação ao plano: a RA abre como camada sobre o Novo registro (`?ra=1`), não em rota própria, para não perder o formulário; o pé-direito e o piso acabado da HTO (0,385 m e 2,60 m) valem para todos os ambientes e vêm de `data/hto/obra.json`; a detecção de passos pelo acelerômetro não foi feita.
