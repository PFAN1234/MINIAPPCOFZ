-- Fase 3: plantas de arquitetura (tabelas, RLS e bucket privado `plantas`).
-- Contrato: docs/contrato-fase3.md (seção A).
-- Caminho dos arquivos: <obra_id>/<revisao>/<pavimento_codigo>/planta.webp | planta-hd.webp | ambientes/<ambiente_codigo>.webp

create table public.planta (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  pavimento_id uuid not null,
  revisao text not null,
  pdf_sha256 text,
  pagina_largura_pt numeric not null,
  pagina_altura_pt numeric not null,
  recorte_pt numeric[] not null,  -- [x0, y0, x1, y1] em pontos do PDF, origem no canto superior esquerdo
  imagem_path text not null,
  imagem_largura int not null,
  imagem_altura int not null,
  imagem_hd_path text,
  imagem_hd_largura int,
  imagem_hd_altura int,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint planta_pavimento_fk foreign key (pavimento_id, obra_id)
    references public.pavimento (id, obra_id) on delete cascade,
  constraint planta_revisao_unica unique (pavimento_id, revisao),
  constraint planta_id_obra_unico unique (id, obra_id),
  constraint planta_recorte_4_itens check (array_length(recorte_pt, 1) = 4),
  constraint planta_inteiros_positivos check (
    imagem_largura > 0 and imagem_altura > 0
    and (imagem_hd_largura is null or imagem_hd_largura > 0)
    and (imagem_hd_altura is null or imagem_hd_altura > 0)
  )
);
create unique index planta_ativa_unica on public.planta (pavimento_id) where ativa;
create index planta_obra_idx on public.planta (obra_id);

create table public.planta_detalhe (
  planta_id uuid not null,
  obra_id uuid not null,
  ambiente_id uuid not null,
  imagem_path text not null,
  recorte_pt numeric[] not null,
  largura int not null,
  altura int not null,
  primary key (planta_id, ambiente_id),
  constraint planta_detalhe_planta_fk foreign key (planta_id, obra_id)
    references public.planta (id, obra_id) on delete cascade,
  constraint planta_detalhe_ambiente_fk foreign key (ambiente_id, obra_id)
    references public.ambiente (id, obra_id),
  constraint planta_detalhe_recorte_4_itens check (array_length(recorte_pt, 1) = 4),
  constraint planta_detalhe_inteiros_positivos check (largura > 0 and altura > 0)
);
create index planta_detalhe_ambiente_idx on public.planta_detalhe (ambiente_id, obra_id);
create index planta_detalhe_obra_idx on public.planta_detalhe (obra_id);

-- RLS e grants: o cliente só lê; a gravação é feita pelo seed (service role).
alter table public.planta enable row level security;
alter table public.planta_detalhe enable row level security;

revoke all on public.planta, public.planta_detalhe from anon, authenticated;
grant select on public.planta, public.planta_detalhe to authenticated;

create policy planta_select on public.planta
  for select to authenticated using (privado.eh_participante(obra_id));

create policy planta_detalhe_select on public.planta_detalhe
  for select to authenticated using (privado.eh_participante(obra_id));

-- Bucket privado `plantas` (imagens WebP, até 5 MB) ------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plantas', 'plantas', false, 5242880, array['image/webp'])
on conflict (id) do nothing;

create policy plantas_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plantas'
    and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))
  );

-- Sem política de insert, update nem delete: o envio é feito com a chave secreta
-- (scripts/publicar_plantas.py), que ignora a RLS.
