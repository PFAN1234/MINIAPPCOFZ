# Contrato — Realidade aumentada (RA)

Plano: `tasks/plano-ra.md`. Este arquivo fixa nomes, unidades e referenciais usados pelo banco, pelos scripts, pelo Mini App e pelo site de administração.

## Referencial

Toda a geometria da RA fica no **referencial local do `ARQ.frag`** da obra (convenção do Three.js: metros, Y para cima). É o referencial em que o `.frag` de arquitetura é desenhado sem nenhuma matriz.

Para a HTO, a passagem do referencial do inventário do IFC de arquitetura (`artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json`, campos `footprint_world_xy_m` e `bbox_world_m`, Z para cima) para o `ARQ.frag` R06 foi ajustada pelas faces das paredes (2 877 vértices a menos de 1 cm, erro médio quadrático de 3 mm):

```text
θ  = -0,016167004574873148 rad   (-0,9263°)
tx = 197,0365965562527
ty = 333,84178410152947

u  =  cos(θ)·(ix − tx) + sen(θ)·(iy − ty)
v  = −sen(θ)·(ix − tx) + cos(θ)·(iy − ty)

frag_x = −u
frag_z =  v
frag_y = iz − 1,19
```

Os outros modelos (ELT e demais) entram nesse referencial pela coordenação da That Open: cada `.frag` grava suas coordenadas (`getCoordinates()`: 9 números) e a biblioteca desloca o modelo em `coordenadas do ARQ − coordenadas do modelo`. Depois disso entra a correção opcional guardada em `modelo.matriz`. As coordenadas do ARQ usadas no ajuste ficam em `ra_referencial`. Para o `ARQ.frag` R06 da HTO: `[201.82966, -1.19, -327.13588, 1, 0, 0, 0, 1, 0]`.

## Banco

```sql
create table public.ra_referencial (
  obra_id uuid primary key references public.obra (id) on delete cascade,
  sigla text not null default 'ARQ',
  revisao text,
  coordenadas jsonb not null,          -- 9 números de getCoordinates() do .frag de referência
  atualizado_em timestamptz not null default now()
);

create table public.ambiente_geometria (
  ambiente_id uuid primary key references public.ambiente (id) on delete cascade,
  guid text,                            -- GlobalId do IfcSpace
  contorno jsonb not null,              -- [[x, z], ...] em metros, sem repetir o primeiro ponto, 3+ pontos
  contorno_pagina jsonb,                -- cantos de contorno na página da planta: [[x, y], ...] de 0 a 1, mesma ordem; nula até regerar
  y_piso double precision not null,     -- piso acabado
  y_teto double precision not null,     -- forro
  origem text not null default 'ifcspace',
  atualizado_em timestamptz not null default now()
);

create table public.ambiente_qr (
  ambiente_id uuid primary key references public.ambiente (id) on delete cascade,
  parede int not null,                  -- aresta i do contorno: de contorno[i] a contorno[(i+1) % n]
  distancia_m double precision not null,-- de contorno[i] até o centro do QR, ao longo da parede
  altura_m double precision not null default 1.5,  -- centro do QR acima do piso acabado
  lado_m double precision not null default 0.18,   -- lado do quadrado do QR (sem a margem branca)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuario (id) on delete set null
);

alter table public.modelo add column matriz jsonb;   -- 16 números, ordem de THREE.Matrix4.elements; null = identidade
alter table public.foto
  add column origem text not null default 'normal' check (origem in ('normal', 'ra_limpa', 'ra_modelo')),
  add column ra jsonb;
```

- Leitura das três tabelas novas: participantes da obra do ambiente (mesma regra de `ambiente`) e admins. Escrita só por RPC de admin ou pelo `service_role`/seed.
- `concluir_registro`: cada item de `fotos` aceita os campos opcionais `origem` e `ra`; ausentes valem `'normal'` e `null`. `ra` só é aceito quando `origem` começa com `ra_`.
- RPCs de admin (padrão das demais `admin_*`): `admin_listar_ra(p_obra uuid)` devolve, por ambiente ativo da obra com geometria, `ambiente_id`, `codigo`, `nome`, `pavimento` (nome), `contorno`, `y_piso`, `y_teto` e `qr` (objeto `{parede, distancia_m, altura_m, lado_m}` ou null); `admin_definir_qr(p_ambiente uuid, p_parede int, p_distancia_m double precision, p_altura_m double precision, p_lado_m double precision)`; `admin_remover_qr(p_ambiente uuid)`.

## `foto.ra`

```json
{
  "par": "<id da outra foto do par>",
  "modelos": [{ "sigla": "ELT", "revisao": "R01", "hash": "…" }],
  "alinhamento": "cantos" | "qr",
  "pose": { "posicao": [x, y, z], "rumo": 0.0, "fov": 60.0 },
  "erro_cm": 3.2
}
```

`erro_cm` só aparece quando o fiscal conferiu um terceiro canto.

## QR

O QR carrega o link do ambiente: `https://t.me/<bot>/<app>?startapp=amb_<slug>_<codigo>`. Fica na face interna da parede, virado para dentro do ambiente, com as bordas alinhadas com a vertical.

## Dados por obra

`scripts/gerar_geometria.py --obra <slug>` grava `data/<slug>/geometria.json` e `supabase/seed/<slug>_geometria.sql`.

```json
{
  "obra": "hto",
  "referencial": { "sigla": "ARQ", "revisao": "R06", "coordenadas": [201.82966, -1.19, -327.13588, 1, 0, 0, 0, 1, 0] },
  "ambientes": {
    "<codigo do ambiente>": { "guid": "…", "contorno": [[x, z], …], "y_piso": -0.805, "y_teto": 1.795, "area_m2": 23.88 }
  },
  "sem_vinculo": [{ "codigo": "…", "motivo": "…" }]
}
```
