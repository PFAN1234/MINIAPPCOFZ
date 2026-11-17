# RA no admin: planta baixa no ajuste do QR

Aprovado em 2026-11-17. Mudança pequena.

## Intenção
Na tela `/admin/obras/<slug>/ra` (ambiente aberto), mostrar a planta baixa real, com o cômodo, os cantos numerados e a marca do QR, no lugar do desenho esquemático do contorno. Ajuda o admin a conferir onde o QR fica na parede.

## Objetivos
- Planta real enquadrada no cômodo, com polígono, cantos/paredes numerados e marca do QR.
- A marca acompanha os campos (parede, distância, lado) enquanto o admin digita.
- Sem `contorno_pagina` ou sem recorte: mantém o desenho esquemático atual.

## Fora do escopo
- Posicionar o QR clicando na planta (escolhido: só visualizar).
- Folha de impressão.

## Abordagens consideradas
1. **Estender a RPC `admin_listar_ra` (escolhida):** nova migration devolve `contorno_pagina` e a planta ativa do pavimento (`public.planta`: imagem, `pagina_pt`, `recorte_pt`); URL assinada do bucket `plantas`. Uma ida ao banco; exige aplicar a migration em produção.
2. Consultas separadas no cliente: sem migration, mais idas ao banco e depende das políticas de leitura do admin.

## Design
- Migration: `admin_listar_ra` inclui `contorno_pagina` e `planta` (`imagem_path`, `pagina_pt`, `recorte_pt`, `largura`, `altura`) da planta ativa do pavimento (HD quando houver, como no app), nulos se ausentes. O admin já lê o bucket (`plantas_admin_select`).
- Admin: o repositório assina `imagem_path` no bucket `plantas`; se a assinatura falhar, `url` fica nula e a tela usa o desenho esquemático. `AmbienteRA` ganha `contorno_pagina` e `planta`.
- Marca do QR (decisão do Claude): interpola sobre a parede nas coordenadas da página, na fração `distancia_m / comprimento da parede`; o lado vira fração do comprimento. Sem mapeamento global metros → página.
- Sem refatorar o app (decisão do Claude, corrige a versão aprovada): o admin é autocontido (tem `admin/ra/geometria.ts` próprio), então a conversão página → pixel entra em `admin/ra/planta.ts`; `TelaRA.tsx` não muda.
- Testes: conversão da marca, fallback sem planta, fixture do admin.
