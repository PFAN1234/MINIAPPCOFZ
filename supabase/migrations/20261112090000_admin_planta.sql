-- Site de administração, fase 2: planta (PDF) publicada pelo navegador do admin.
-- Plano: tasks/plano-admin.md; documentação: docs/admin.md ("Planta"); contrato: docs/contrato-fase3.md.
--
-- - Bucket privado `originais` (PDF enviado, até 50 MB): só admins leem e gravam.
-- - Admin grava (insert/update) no bucket `plantas`, nos caminhos de uma obra existente.
-- - `publicacao_planta`: histórico das publicações (quem, quando, revisão, PDF, diferenças).
-- - RPC `admin_publicar_revisao`: o mesmo efeito do seed de `scripts/gerar_seed.py` para os
--   pavimentos enviados, numa transação; atualiza `obra_config`.
-- - RPCs `admin_editor_planta` e `admin_listar_publicacoes` para o editor.

-- Caminhos no Storage ---------------------------------------------------------------------------

-- O 1º segmento do caminho é o id de uma obra existente?
create function privado.caminho_de_obra(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.obra o
     where o.id = privado.uuid_ou_nulo((storage.foldername(p_nome))[1])
  );
$$;
revoke execute on function privado.caminho_de_obra(text) from public, anon;
grant execute on function privado.caminho_de_obra(text) to authenticated;

-- Bucket `originais`: <obra_id>/<revisao>/<pavimento>/<sha256>.pdf ------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('originais', 'originais', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy originais_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'originais' and privado.eh_admin());

create policy originais_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'originais'
    and privado.eh_admin()
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,19}/[a-z0-9][a-z0-9-]{0,29}/[0-9a-f]{64}\.pdf$'
    and privado.caminho_de_obra(name)
  );

create policy originais_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'originais' and privado.eh_admin())
  with check (
    bucket_id = 'originais'
    and privado.eh_admin()
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,19}/[a-z0-9][a-z0-9-]{0,29}/[0-9a-f]{64}\.pdf$'
    and privado.caminho_de_obra(name)
  );

-- Bucket `plantas`: admin grava nas pastas das obras. A leitura dos participantes não muda;
-- o admin também lê (o upsert do Storage exige select, insert e update).

create policy plantas_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'plantas' and privado.eh_admin());

create policy plantas_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plantas' and privado.eh_admin() and privado.caminho_de_obra(name));

create policy plantas_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'plantas' and privado.eh_admin())
  with check (bucket_id = 'plantas' and privado.eh_admin() and privado.caminho_de_obra(name));

-- Histórico das publicações ---------------------------------------------------------------------

create table public.publicacao_planta (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  pavimento_id uuid not null,
  revisao text not null,
  publicado_por uuid references public.usuario (id) on delete set null,
  publicado_em timestamptz not null default now(),
  pdf_path text not null,
  pdf_sha256 text not null,
  pdf_nome text,
  pagina int not null default 1,
  -- diferenças em relação ao banco (formato `diferencas` do extrator) e contagens
  resumo jsonb not null default '{}'::jsonb,
  constraint publicacao_planta_pavimento_fk foreign key (pavimento_id, obra_id)
    references public.pavimento (id, obra_id) on delete cascade,
  constraint publicacao_planta_sha256 check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint publicacao_planta_resumo_objeto check (jsonb_typeof(resumo) = 'object')
);
create index publicacao_planta_obra_idx on public.publicacao_planta (obra_id, publicado_em desc);
create index publicacao_planta_pavimento_idx on public.publicacao_planta (pavimento_id, publicado_em desc);
alter table public.publicacao_planta enable row level security;
revoke all on public.publicacao_planta from public, anon, authenticated;

comment on table public.publicacao_planta is
  'Publicações de planta feitas pelo site de administração; leitura só por admin, via RPC.';

-- Auxiliares de validação -----------------------------------------------------------------------

-- Número de um campo jsonb (22023 se não for número; null se ausente e permitido).
create function privado.numero_jsonb(p_valor jsonb, p_campo text, p_nulo boolean default false)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_valor is null or jsonb_typeof(p_valor) = 'null' then
    if p_nulo then
      return null;
    end if;
    raise exception 'O campo % é obrigatório', p_campo using errcode = '22023';
  end if;
  if jsonb_typeof(p_valor) <> 'number' then
    raise exception 'O campo % precisa ser um número', p_campo using errcode = '22023';
  end if;
  return (p_valor #>> '{}')::numeric;
end;
$$;
revoke execute on function privado.numero_jsonb(jsonb, text, boolean) from public, anon, authenticated;

-- Lista de N números (recorte_pt, pagina_pt).
create function privado.numeros_jsonb(p_valor jsonb, p_campo text, p_n int)
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric[];
begin
  if p_valor is null or jsonb_typeof(p_valor) <> 'array' or jsonb_array_length(p_valor) <> p_n
     or exists (select 1 from jsonb_array_elements(p_valor) e where jsonb_typeof(e) <> 'number') then
    raise exception 'O campo % precisa ser uma lista de % números', p_campo, p_n using errcode = '22023';
  end if;
  select array_agg((e #>> '{}')::numeric order by i) into v
    from jsonb_array_elements(p_valor) with ordinality as t(e, i);
  return v;
end;
$$;
revoke execute on function privado.numeros_jsonb(jsonb, text, int) from public, anon, authenticated;

-- Inteiro positivo (largura/altura de imagem).
create function privado.positivo_jsonb(p_valor jsonb, p_campo text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v int;
begin
  v := privado.inteiro_jsonb(p_valor, p_campo);
  if v is null or v <= 0 then
    raise exception 'O campo % precisa ser um inteiro positivo', p_campo using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke execute on function privado.positivo_jsonb(jsonb, text) from public, anon, authenticated;

-- Publicar -------------------------------------------------------------------------------------

-- Payload (o site monta em app/src/admin/planta/publicar.ts):
-- {
--   "pavimentos": [{
--     "codigo": "terreo", "revisao": "R06",
--     "pdf": {"path": "<obra_id>/R06/terreo/<sha256>.pdf", "sha256": "...", "nome": "X-R06.pdf", "pagina": 1},
--     "pagina_pt": [w, h], "recorte_pt": [x0, y0, x1, y1],
--     "imagem": {"largura": n, "altura": n}, "imagem_hd": {"largura": n, "altura": n},
--     "detalhes": {"<codigo>": {"recorte_pt": [...], "largura": n, "altura": n}},
--     "resumo": {...}                                  -- opcional (diferenças)
--   }],
--   "ambientes": [{"codigo", "pavimento", "nome_operacional", "nome_planta", "categoria",
--                  "area_m2", "marcadores"}],          -- na ordem da lista (ordem natural)
--   "ambientes_removidos": ["<codigo>", ...],          -- ficam inativos
--   "config": {...}, "config_atualizada_em": "..."     -- opcionais (juntos)
-- }
create function public.admin_publicar_revisao(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_pav jsonb;
  v_amb jsonb;
  v_det jsonb;
  v_m jsonb;
  v_codigo text;
  v_revisao text;
  v_pav_id uuid;
  v_pav_ids uuid[] := '{}';
  v_pav_codigos text[] := '{}';
  v_codigos text[] := '{}';
  v_removidos text[] := '{}';
  v_base text;
  v_pdf_path text;
  v_sha text;
  v_planta_id uuid;
  v_ordem int := 0;
  v_n int;
  v_inativados int := 0;
  v_publicacoes jsonb := '[]'::jsonb;
  v_pub_id uuid;
  v_conflito text;
  v_config_atual timestamptz;
  v_tem_config boolean;
  v_x numeric;
  v_y numeric;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  -- Serializa publicações e edições da mesma obra.
  perform 1 from public.obra o where o.id = v_obra.id for update;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da publicação inválidos' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'pavimentos') is distinct from 'array' or jsonb_array_length(p -> 'pavimentos') = 0 then
    raise exception 'Informe ao menos um pavimento' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'ambientes') is distinct from 'array' then
    raise exception 'A lista de ambientes é inválida' using errcode = '22023';
  end if;
  if p ? 'ambientes_removidos' and jsonb_typeof(p -> 'ambientes_removidos') <> 'array' then
    raise exception 'A lista de ambientes removidos é inválida' using errcode = '22023';
  end if;

  -- Pavimentos: existência, revisão, PDF e imagens.
  for v_pav in select * from jsonb_array_elements(p -> 'pavimentos') loop
    if jsonb_typeof(v_pav) <> 'object' or jsonb_typeof(v_pav -> 'codigo') is distinct from 'string' then
      raise exception 'Cada pavimento precisa do código' using errcode = '22023';
    end if;
    v_codigo := v_pav ->> 'codigo';
    if v_codigo = any (v_pav_codigos) then
      raise exception 'Pavimento repetido na publicação: %', v_codigo using errcode = '22023';
    end if;
    select pv.id into v_pav_id from public.pavimento pv where pv.obra_id = v_obra.id and pv.codigo = v_codigo;
    if v_pav_id is null then
      raise exception 'Pavimento não encontrado na obra: %', v_codigo using errcode = '22023';
    end if;
    v_revisao := v_pav ->> 'revisao';
    if v_revisao is null or v_revisao !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$' then
      raise exception 'Revisão inválida no pavimento %: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R07)', v_codigo
        using errcode = '22023';
    end if;
    v_sha := v_pav -> 'pdf' ->> 'sha256';
    if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'SHA-256 do PDF inválido no pavimento %', v_codigo using errcode = '22023';
    end if;
    v_pdf_path := v_obra.id::text || '/' || v_revisao || '/' || v_codigo || '/' || v_sha || '.pdf';
    if (v_pav -> 'pdf' ->> 'path') is distinct from v_pdf_path then
      raise exception 'Caminho do PDF inválido no pavimento % (esperado %)', v_codigo, v_pdf_path using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'originais' and o.name = v_pdf_path) then
      raise exception 'PDF não encontrado no Storage (originais/%): envie o arquivo antes de publicar', v_pdf_path
        using errcode = 'P0002';
    end if;
    perform privado.inteiro_jsonb(v_pav -> 'pdf' -> 'pagina', 'pdf.pagina');
    perform privado.numeros_jsonb(v_pav -> 'pagina_pt', 'pagina_pt', 2);
    perform privado.numeros_jsonb(v_pav -> 'recorte_pt', 'recorte_pt', 4);
    perform privado.positivo_jsonb(v_pav -> 'imagem' -> 'largura', 'imagem.largura');
    perform privado.positivo_jsonb(v_pav -> 'imagem' -> 'altura', 'imagem.altura');
    perform privado.positivo_jsonb(v_pav -> 'imagem_hd' -> 'largura', 'imagem_hd.largura');
    perform privado.positivo_jsonb(v_pav -> 'imagem_hd' -> 'altura', 'imagem_hd.altura');
    if jsonb_typeof(v_pav -> 'detalhes') is distinct from 'object' then
      raise exception 'Faltam os detalhes do pavimento %', v_codigo using errcode = '22023';
    end if;
    if v_pav ? 'resumo' and jsonb_typeof(v_pav -> 'resumo') <> 'object' then
      raise exception 'O resumo do pavimento % precisa ser um objeto', v_codigo using errcode = '22023';
    end if;
    v_base := v_obra.id::text || '/' || v_revisao || '/' || v_codigo || '/';
    select string_agg(c, ', ' order by c) into v_conflito
      from unnest(array[v_base || 'planta.webp', v_base || 'planta-hd.webp']
                  || array(select v_base || 'ambientes/' || k || '.webp' from jsonb_object_keys(v_pav -> 'detalhes') k)) c
     where not exists (select 1 from storage.objects o where o.bucket_id = 'plantas' and o.name = c);
    if v_conflito is not null then
      raise exception 'Imagens não encontradas no Storage (plantas): %', v_conflito using errcode = 'P0002';
    end if;
    v_pav_codigos := v_pav_codigos || v_codigo;
    v_pav_ids := v_pav_ids || v_pav_id;
  end loop;

  -- Ambientes: campos, códigos únicos, pavimento publicado e detalhe correspondente.
  for v_amb in select * from jsonb_array_elements(p -> 'ambientes') loop
    if jsonb_typeof(v_amb) <> 'object'
       or jsonb_typeof(v_amb -> 'codigo') is distinct from 'string'
       or jsonb_typeof(v_amb -> 'pavimento') is distinct from 'string'
       or jsonb_typeof(v_amb -> 'nome_operacional') is distinct from 'string'
       or jsonb_typeof(v_amb -> 'categoria') is distinct from 'string' then
      raise exception 'Cada ambiente precisa de código, pavimento, nome operacional e categoria' using errcode = '22023';
    end if;
    v_codigo := v_amb ->> 'codigo';
    if v_codigo !~ '^[a-z0-9][a-z0-9-]*$' or char_length(v_codigo) > 120 then
      raise exception 'Código de ambiente inválido: %', v_codigo using errcode = '22023';
    end if;
    if v_codigo = any (v_codigos) then
      raise exception 'Código de ambiente repetido: %', v_codigo using errcode = '22023';
    end if;
    if not ((v_amb ->> 'pavimento') = any (v_pav_codigos)) then
      raise exception 'O ambiente % é de um pavimento que não está na publicação (%)', v_codigo, v_amb ->> 'pavimento'
        using errcode = '22023';
    end if;
    if btrim(v_amb ->> 'nome_operacional') = '' or btrim(v_amb ->> 'categoria') = '' then
      raise exception 'Nome operacional e categoria do ambiente % não podem ficar vazios', v_codigo using errcode = '22023';
    end if;
    if v_amb ? 'nome_planta' and jsonb_typeof(v_amb -> 'nome_planta') not in ('string', 'null') then
      raise exception 'O nome na planta do ambiente % precisa ser texto', v_codigo using errcode = '22023';
    end if;
    perform privado.numero_jsonb(v_amb -> 'area_m2', 'area_m2', true);
    if jsonb_typeof(v_amb -> 'marcadores') is distinct from 'array' or jsonb_array_length(v_amb -> 'marcadores') = 0 then
      raise exception 'O ambiente % precisa de ao menos um pino', v_codigo using errcode = '22023';
    end if;
    for v_m in select * from jsonb_array_elements(v_amb -> 'marcadores') loop
      v_x := privado.numero_jsonb(v_m -> 'x', 'marcadores.x');
      v_y := privado.numero_jsonb(v_m -> 'y', 'marcadores.y');
      if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then
        raise exception 'Pino do ambiente % fora da página (0–1)', v_codigo using errcode = '22023';
      end if;
    end loop;
    select x into v_pav from jsonb_array_elements(p -> 'pavimentos') x where x ->> 'codigo' = v_amb ->> 'pavimento';
    v_det := v_pav -> 'detalhes' -> v_codigo;
    if v_det is null then
      raise exception 'Falta o detalhe (recorte) do ambiente %', v_codigo using errcode = '22023';
    end if;
    perform privado.numeros_jsonb(v_det -> 'recorte_pt', 'detalhes.recorte_pt', 4);
    perform privado.positivo_jsonb(v_det -> 'largura', 'detalhes.largura');
    perform privado.positivo_jsonb(v_det -> 'altura', 'detalhes.altura');
    v_codigos := v_codigos || v_codigo;
  end loop;
  foreach v_codigo in array v_pav_codigos loop
    if not exists (select 1 from jsonb_array_elements(p -> 'ambientes') a where a ->> 'pavimento' = v_codigo) then
      raise exception 'O pavimento % ficou sem ambientes', v_codigo using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(r #>> '{}'), '{}') into v_removidos
    from jsonb_array_elements(coalesce(p -> 'ambientes_removidos', '[]'::jsonb)) r;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'ambientes_removidos', '[]'::jsonb)) r
              where jsonb_typeof(r) <> 'string') then
    raise exception 'Ambientes removidos: informe os códigos' using errcode = '22023';
  end if;
  select string_agg(c, ', ' order by c) into v_conflito from unnest(v_removidos) c where c = any (v_codigos);
  if v_conflito is not null then
    raise exception 'Códigos na lista e nos removidos ao mesmo tempo: %', v_conflito using errcode = '22023';
  end if;

  -- Configuração (opcional) com trava otimista.
  v_tem_config := p ? 'config' and jsonb_typeof(p -> 'config') <> 'null';
  if v_tem_config then
    if jsonb_typeof(p -> 'config') <> 'object' then
      raise exception 'A configuração precisa ser um objeto JSON' using errcode = '22023';
    end if;
    select c.atualizado_em into v_config_atual from public.obra_config c where c.obra_id = v_obra.id;
    if v_config_atual is distinct from (p ->> 'config_atualizada_em')::timestamptz then
      raise exception 'A configuração da obra foi alterada por outra pessoa. Recarregue a página e confira antes de publicar.'
        using errcode = '40001';
    end if;
  end if;

  -- Ambientes: upsert com ativo = true, na ordem da lista.
  for v_amb in select * from jsonb_array_elements(p -> 'ambientes') loop
    v_ordem := v_ordem + 1;
    insert into public.ambiente (obra_id, pavimento_id, codigo, nome_operacional, nome_planta, categoria,
                                 area_m2, revisao_planta, marcadores, ordem, ativo)
    select v_obra.id, pv.id, v_amb ->> 'codigo', btrim(v_amb ->> 'nome_operacional'), v_amb ->> 'nome_planta',
           btrim(v_amb ->> 'categoria'), (v_amb ->> 'area_m2')::numeric,
           (select x ->> 'revisao' from jsonb_array_elements(p -> 'pavimentos') x
             where x ->> 'codigo' = v_amb ->> 'pavimento'),
           v_amb -> 'marcadores', v_ordem, true
      from public.pavimento pv
     where pv.obra_id = v_obra.id and pv.codigo = v_amb ->> 'pavimento'
    on conflict (obra_id, codigo) do update
      set pavimento_id = excluded.pavimento_id, nome_operacional = excluded.nome_operacional,
          nome_planta = excluded.nome_planta, categoria = excluded.categoria, area_m2 = excluded.area_m2,
          revisao_planta = excluded.revisao_planta, marcadores = excluded.marcadores, ordem = excluded.ordem,
          ativo = excluded.ativo;
  end loop;

  -- Removidos (em qualquer pavimento, como no seed) e qualquer ambiente fora da lista nos
  -- pavimentos publicados ficam inativos. Os outros pavimentos não mudam.
  update public.ambiente a set ativo = false
   where a.obra_id = v_obra.id and a.ativo
     and (a.codigo = any (v_removidos)
          or (a.pavimento_id = any (v_pav_ids) and not (a.codigo = any (v_codigos))));
  get diagnostics v_inativados = row_count;

  -- Ordem global dos ativos: pavimento e depois a ordem dentro dele (a do seed).
  with nova as (
    select a.id, row_number() over (order by pv.ordem, pv.codigo, a.ordem, a.codigo)::int as ordem
      from public.ambiente a join public.pavimento pv on pv.id = a.pavimento_id
     where a.obra_id = v_obra.id and a.ativo
  )
  update public.ambiente a set ordem = nova.ordem from nova where a.id = nova.id and a.ordem <> nova.ordem;

  -- Plantas e detalhes de cada pavimento.
  for v_pav in select * from jsonb_array_elements(p -> 'pavimentos') loop
    v_codigo := v_pav ->> 'codigo';
    v_revisao := v_pav ->> 'revisao';
    select pv.id into v_pav_id from public.pavimento pv where pv.obra_id = v_obra.id and pv.codigo = v_codigo;
    v_base := v_obra.id::text || '/' || v_revisao || '/' || v_codigo || '/';

    update public.planta pl set ativa = false
     where pl.pavimento_id = v_pav_id and pl.revisao <> v_revisao and pl.ativa;

    insert into public.planta (obra_id, pavimento_id, revisao, pdf_sha256, pagina_largura_pt, pagina_altura_pt,
                               recorte_pt, imagem_path, imagem_largura, imagem_altura, imagem_hd_path,
                               imagem_hd_largura, imagem_hd_altura, ativa)
    values (v_obra.id, v_pav_id, v_revisao, v_pav -> 'pdf' ->> 'sha256',
            (v_pav -> 'pagina_pt' ->> 0)::numeric, (v_pav -> 'pagina_pt' ->> 1)::numeric,
            privado.numeros_jsonb(v_pav -> 'recorte_pt', 'recorte_pt', 4),
            v_base || 'planta.webp', (v_pav -> 'imagem' ->> 'largura')::int, (v_pav -> 'imagem' ->> 'altura')::int,
            v_base || 'planta-hd.webp', (v_pav -> 'imagem_hd' ->> 'largura')::int,
            (v_pav -> 'imagem_hd' ->> 'altura')::int, true)
    on conflict (pavimento_id, revisao) do update
      set pdf_sha256 = excluded.pdf_sha256, pagina_largura_pt = excluded.pagina_largura_pt,
          pagina_altura_pt = excluded.pagina_altura_pt, recorte_pt = excluded.recorte_pt,
          imagem_path = excluded.imagem_path, imagem_largura = excluded.imagem_largura,
          imagem_altura = excluded.imagem_altura, imagem_hd_path = excluded.imagem_hd_path,
          imagem_hd_largura = excluded.imagem_hd_largura, imagem_hd_altura = excluded.imagem_hd_altura,
          ativa = excluded.ativa
    returning id into v_planta_id;

    insert into public.planta_detalhe (planta_id, obra_id, ambiente_id, imagem_path, recorte_pt, largura, altura)
    select v_planta_id, v_obra.id, a.id, v_base || 'ambientes/' || a.codigo || '.webp',
           privado.numeros_jsonb(v_pav -> 'detalhes' -> a.codigo -> 'recorte_pt', 'detalhes.recorte_pt', 4),
           (v_pav -> 'detalhes' -> a.codigo ->> 'largura')::int, (v_pav -> 'detalhes' -> a.codigo ->> 'altura')::int
      from public.ambiente a
     where a.obra_id = v_obra.id and a.pavimento_id = v_pav_id
       and a.codigo = any (v_codigos)
    on conflict (planta_id, ambiente_id) do update
      set obra_id = excluded.obra_id, imagem_path = excluded.imagem_path, recorte_pt = excluded.recorte_pt,
          largura = excluded.largura, altura = excluded.altura;

    select count(*) into v_n from jsonb_array_elements(p -> 'ambientes') a where a ->> 'pavimento' = v_codigo;
    insert into public.publicacao_planta (obra_id, pavimento_id, revisao, publicado_por, pdf_path, pdf_sha256,
                                          pdf_nome, pagina, resumo)
    values (v_obra.id, v_pav_id, v_revisao, auth.uid(),
            v_obra.id::text || '/' || v_revisao || '/' || v_codigo || '/' || (v_pav -> 'pdf' ->> 'sha256') || '.pdf',
            v_pav -> 'pdf' ->> 'sha256', left(v_pav -> 'pdf' ->> 'nome', 200),
            coalesce(privado.inteiro_jsonb(v_pav -> 'pdf' -> 'pagina', 'pdf.pagina'), 1),
            coalesce(v_pav -> 'resumo', '{}'::jsonb) || jsonb_build_object('ambientes', v_n))
    returning id into v_pub_id;
    v_publicacoes := v_publicacoes || jsonb_build_object('id', v_pub_id, 'pavimento', v_codigo, 'revisao', v_revisao);
  end loop;

  -- A publicação precisa de nova conferência humana.
  if v_tem_config then
    insert into public.obra_config (obra_id, config, atualizado_em, atualizado_por)
    values (v_obra.id, (p -> 'config') || '{"status": "aguardando_revisao_humana"}'::jsonb, now(), auth.uid())
    on conflict (obra_id) do update
      set config = excluded.config, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;
  end if;

  return jsonb_build_object(
    'publicacoes', v_publicacoes,
    'ambientes_ativos', (select count(*) from public.ambiente a where a.obra_id = v_obra.id and a.ativo),
    'inativados', v_inativados
  );
end;
$$;

-- Dados do editor: ambientes (inclusive inativos), planta ativa e último PDF guardado por pavimento.
create function public.admin_editor_planta(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  return jsonb_build_object(
    'obra', jsonb_build_object('id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome),
    'config', (select c.config from public.obra_config c where c.obra_id = v_obra.id),
    'config_atualizada_em', (select c.atualizado_em from public.obra_config c where c.obra_id = v_obra.id),
    'pavimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', pv.codigo, 'nome', pv.nome, 'ordem', pv.ordem,
               'planta', (
                 select jsonb_build_object(
                          'revisao', pl.revisao, 'pdf_sha256', pl.pdf_sha256,
                          'pagina_pt', jsonb_build_array(pl.pagina_largura_pt, pl.pagina_altura_pt),
                          'recorte_pt', to_jsonb(pl.recorte_pt), 'criado_em', pl.criado_em)
                   from public.planta pl where pl.pavimento_id = pv.id and pl.ativa
               ),
               'ultimo_pdf', (
                 select jsonb_build_object(
                          'path', pp.pdf_path, 'sha256', pp.pdf_sha256, 'nome', pp.pdf_nome,
                          'pagina', pp.pagina, 'revisao', pp.revisao, 'publicado_em', pp.publicado_em)
                   from public.publicacao_planta pp where pp.pavimento_id = pv.id
                  order by pp.publicado_em desc, pp.id limit 1
               )
             ) order by pv.ordem, pv.codigo)
        from public.pavimento pv where pv.obra_id = v_obra.id
    ), '[]'::jsonb),
    'ambientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', a.codigo, 'pavimento', pv.codigo, 'nome_operacional', a.nome_operacional,
               'nome_planta', a.nome_planta, 'categoria', a.categoria, 'area_m2', a.area_m2,
               'revisao_planta', a.revisao_planta, 'marcadores', a.marcadores, 'ordem', a.ordem,
               'ativo', a.ativo
             ) order by pv.ordem, a.ordem, a.codigo)
        from public.ambiente a join public.pavimento pv on pv.id = a.pavimento_id
       where a.obra_id = v_obra.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.admin_listar_publicacoes(p_slug text)
returns table (
  id uuid,
  pavimento text,
  pavimento_nome text,
  revisao text,
  publicado_em timestamptz,
  publicado_por_nome text,
  pdf_path text,
  pdf_sha256 text,
  pdf_nome text,
  pagina int,
  resumo jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  return query
  select pp.id, pv.codigo, pv.nome, pp.revisao, pp.publicado_em, u.nome, pp.pdf_path, pp.pdf_sha256,
         pp.pdf_nome, pp.pagina, pp.resumo
    from public.publicacao_planta pp
    join public.pavimento pv on pv.id = pp.pavimento_id
    left join public.usuario u on u.id = pp.publicado_por
   where pp.obra_id = v_obra.id
   order by pp.publicado_em desc, pp.id;
end;
$$;

revoke execute on function public.admin_publicar_revisao(text, jsonb) from public, anon;
revoke execute on function public.admin_editor_planta(text) from public, anon;
revoke execute on function public.admin_listar_publicacoes(text) from public, anon;
grant execute on function public.admin_publicar_revisao(text, jsonb) to authenticated;
grant execute on function public.admin_editor_planta(text) to authenticated;
grant execute on function public.admin_listar_publicacoes(text) to authenticated;
