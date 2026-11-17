# Visualizar modelo 3D a partir do ambiente

Aprovado em 2026-11-17. Mudança pequena.

## Intenção
Na tela do ambiente, um botão "Visualizar modelo" abre o modelo 3D federado, sem RA, com a câmera centrada no ambiente e rotação livre, para ver os detalhes do cômodo em 3D. Um filtro esconde o que não é do ambiente.

## Objetivos
- Botão entre "Novo registro" e "Comparar com o modelo (RA)", visível só com a condição do botão da RA (`temRA`: recurso ligado, ambiente ativo com geometria, obra com modelo).
- Visualizador abre com corte em volta do ambiente e câmera enquadrada na caixa; o usuário orbita, dá zoom e liga/desliga disciplinas.
- Chip "Só este ambiente" liga/desliga o corte (desligado enquadra a obra toda).

## Fora do escopo
Folga ajustável, isolamento por IfcSpace, RA, alterar a tela do modelo da obra.

## Abordagens
1. **Estender `VisualizadorModelo` (escolhida):** prop opcional `ambiente` (geometria). Sem ela, nada muda.
2. Reusar `MotorRA`: preso a sensor/câmera/alinhamento; mais caro.

## Design
- Rota `obras/:slug/ambientes/:codigo/modelo`, tela `AmbienteModelo` (lazy como `Modelo`), com `useGeometria`, `useModelos` e o mesmo `baixar` com cache da tela `Modelo`.
- A geometria está no referencial do ARQ: com `ambiente`, o visualizador define `baseCoordinates = referencial.coordenadas` antes de carregar e aplica `matrizes[sigla] ?? matriz` (como o `MotorRA`). Sem isso o corte cairia no lugar errado.
- Corte: seis planos da `caixaDeCorte` (mesma folga da RA), passados no `load` como array por referência; ligar/desligar esvazia/preenche o array e chama `update(true)`; também no `clippingPlanes` do renderer.
- Decisão do Claude: função pura `planosDeCorte` em `app/src/modelo/corte.ts`, usada também pelo `MotorRA` (troca de código duplicado por chamada; testes da RA cobrem).
- Testes: `planosDeCorte`, botão (aparece/some), rota. WebGL fora dos testes unitários, como na tela `Modelo`.
- Risco: o enquadramento e o corte só se confirmam com o `.frag` real num navegador com WebGL.
