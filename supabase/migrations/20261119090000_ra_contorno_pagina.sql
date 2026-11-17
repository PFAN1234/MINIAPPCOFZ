-- Cantos do contorno do ambiente na página da planta do pavimento, para a RA desenhar os cantos
-- numerados por cima do recorte da planta. Mesmos cantos e mesma ordem de `contorno`, como
-- [x, y] normalizados de 0 a 1 na página (x = pt_x / largura, y = pt_y / altura). Nula = o
-- ambiente ainda não foi regerado (o app apenas não desenha os cantos). Gerada por
-- scripts/gerar_geometria.py junto com o seed da geometria.

alter table public.ambiente_geometria
  add column contorno_pagina jsonb
  check (contorno_pagina is null or (jsonb_typeof(contorno_pagina) = 'array' and jsonb_array_length(contorno_pagina) >= 3));
