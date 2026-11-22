-- Central de modelos, etapa 6 (a): Documentos, o repositório de pranchas e arquivos da obra.
-- - `documento`: uma linha por revisão; `serie` agrupa as revisões do mesmo documento.
--   A revisão vigente da série é a mais recente (por `enviado_em`) entre as não retiradas.
-- - `documento_vinculo`: liga o documento a pavimentos ou elementos (GlobalId) do modelo.
-- - Bucket privado `documentos`: <obra_id>/<serie>/<sha256>.<ext>; só admin lê e grava (sem delete).
-- - Toda escrita nas tabelas passa pelas RPCs `admin_*_documento`.
-- - `admin_central_obras` passa a contar os documentos.

create table public.documento (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  serie uuid not null,
  codigo text,
  titulo text not null,
  tipo text not null,
  disciplina text,
  revisao text not null,
  caminho text not null,
  arquivo_nome text not null,
  mime text not null,
  bytes bigint not null check (bytes > 0 and bytes <= 104857600),
  sha256 text not null,
  visibilidade text not null default 'admin' check (visibilidade in ('admin')),
  enviado_por uuid references public.usuario (id) on delete set null,
  enviado_em timestamptz not null default now(),
  retirado_em timestamptz,
  retirado_por uuid references public.usuario (id) on delete set null,
  constraint documento_serie_revisao_unica unique (serie, revisao),
  constraint documento_tipo check (tipo in ('prancha', 'memorial', 'planilha', 'desenho', 'imagem', 'outro')),
  constraint documento_disciplina check (disciplina is null or disciplina ~ '^[A-Z]{2,4}$'),
  constraint documento_revisao check (revisao ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  constraint documento_sha256 check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint documento_titulo check (char_length(titulo) between 1 and 200),
  constraint documento_codigo check (codigo is null or char_length(codigo) <= 60)
);
create index documento_obra_idx on public.documento (obra_id);
create index documento_serie_idx on public.documento (serie);

create table public.documento_vinculo (
  documento_id uuid not null references public.documento (id) on delete cascade,
  tipo text not null check (tipo in ('pavimento', 'elemento')),
  sigla text not null,
  global_id text not null,
  classe text,
  nome text,
  primary key (documento_id, sigla, global_id)
);

alter table public.documento enable row level security;
alter table public.documento_vinculo enable row level security;

revoke all on public.documento from public, anon, authenticated;
revoke all on public.documento_vinculo from public, anon, authenticated;
grant select on public.documento to authenticated;
grant select on public.documento_vinculo to authenticated;

create policy documento_select on public.documento
  for select to authenticated using (privado.eh_admin());
create policy documento_vinculo_select on public.documento_vinculo
  for select to authenticated using (privado.eh_admin());

comment on table public.documento is
  'Documentos da obra (pranchas, memoriais, planilhas...), uma linha por revisão; escrita só pelas RPCs admin_*_documento.';

-- Os arquivos dos documentos ficam no R2 (pasta `documentos`, tabela `arquivo`); sem bucket nem políticas.

-- Auxiliar: documento no formato da listagem --------------------------------------------------------

create function privado.documento_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'serie', d.serie, 'codigo', d.codigo, 'titulo', d.titulo, 'tipo', d.tipo,
    'disciplina', d.disciplina, 'revisao', d.revisao, 'caminho', d.caminho,
    'arquivo_nome', d.arquivo_nome, 'mime', d.mime, 'bytes', d.bytes, 'sha256', d.sha256,
    'enviado_em', d.enviado_em,
    'enviado_por_nome', (select u.nome from public.usuario u where u.id = d.enviado_por),
    'revisoes', (select count(*) from public.documento r where r.serie = d.serie),
    'vinculos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipo', v.tipo, 'sigla', v.sigla, 'global_id', v.global_id, 'classe', v.classe, 'nome', v.nome
             ) order by v.sigla, v.global_id)
        from public.documento_vinculo v where v.documento_id = d.id
    ), '[]'::jsonb)
  )
  from public.documento d
  where d.id = p_id;
$$;
revoke execute on function privado.documento_json(uuid) from public, anon, authenticated;

-- Listar ------------------------------------------------------------------------------------------

-- Retorno: {"documentos": [...]} com a revisão vigente de cada série.
create function public.admin_listar_documentos(p_slug text)
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
  return jsonb_build_object('documentos', coalesce((
    select jsonb_agg(privado.documento_json(v.id) order by v.disciplina nulls last, v.tipo, v.codigo, v.titulo)
      from (
        select distinct on (d.serie) d.id, d.disciplina, d.tipo, d.codigo, d.titulo
          from public.documento d
         where d.obra_id = v_obra.id and d.retirado_em is null
         order by d.serie, d.enviado_em desc
      ) v
  ), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_listar_documentos(text) from public, anon;
grant execute on function public.admin_listar_documentos(text) to authenticated;

-- Histórico ---------------------------------------------------------------------------------------

create function public.admin_historico_documento(p_serie uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if p_serie is null or not exists (select 1 from public.documento d where d.serie = p_serie) then
    raise exception 'Documento não encontrado' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'serie', d.serie, 'codigo', d.codigo, 'titulo', d.titulo, 'tipo', d.tipo,
             'disciplina', d.disciplina, 'revisao', d.revisao, 'caminho', d.caminho,
             'arquivo_nome', d.arquivo_nome, 'mime', d.mime, 'bytes', d.bytes, 'sha256', d.sha256,
             'enviado_em', d.enviado_em,
             'enviado_por_nome', (select u.nome from public.usuario u where u.id = d.enviado_por),
             'retirado_em', d.retirado_em,
             'retirado_por_nome', (select u.nome from public.usuario u where u.id = d.retirado_por)
           ) order by d.enviado_em desc)
      from public.documento d where d.serie = p_serie
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_historico_documento(uuid) from public, anon;
grant execute on function public.admin_historico_documento(uuid) to authenticated;

-- Registrar ---------------------------------------------------------------------------------------

-- Payload (o site monta depois do upload em `documentos`):
-- { "serie": "<uuid>", "codigo": "..." | null, "titulo": "...", "tipo": "prancha", "disciplina": "ARQ" | null,
--   "revisao": "R06", "caminho": "<obra_id>/<serie>/<sha256>.<ext>", "arquivo_nome": "...", "mime": "...",
--   "bytes": n, "sha256": "<64 hex>" }
-- Retorno: o documento no formato da listagem (com `vinculos: []`).
create function public.admin_registrar_documento(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_serie uuid;
  v_codigo text;
  v_titulo text;
  v_tipo text;
  v_disciplina text;
  v_revisao text;
  v_arquivo text;
  v_mime text;
  v_bytes bigint;
  v_sha text;
  v_ext text;
  v_caminho text;
  v_achou boolean;
  v_meta jsonb;
  v_tamanho text;
  v_id uuid;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  -- Serializa os registros da mesma obra.
  perform 1 from public.obra o where o.id = v_obra.id for update;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados do documento inválidos' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'serie') is distinct from 'string'
     or (p ->> 'serie') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Série do documento inválida: esperado um UUID' using errcode = '22023';
  end if;
  v_serie := (p ->> 'serie')::uuid;

  if p ? 'codigo' and jsonb_typeof(p -> 'codigo') <> 'null' then
    if jsonb_typeof(p -> 'codigo') <> 'string' or char_length(btrim(p ->> 'codigo')) > 60 then
      raise exception 'O código do documento precisa ser texto de até 60 caracteres' using errcode = '22023';
    end if;
    v_codigo := nullif(btrim(p ->> 'codigo'), '');
  end if;

  if jsonb_typeof(p -> 'titulo') is distinct from 'string'
     or char_length(btrim(p ->> 'titulo')) not between 1 and 200 then
    raise exception 'O título é obrigatório e tem até 200 caracteres' using errcode = '22023';
  end if;
  v_titulo := btrim(p ->> 'titulo');

  v_tipo := p ->> 'tipo';
  if jsonb_typeof(p -> 'tipo') is distinct from 'string'
     or v_tipo not in ('prancha', 'memorial', 'planilha', 'desenho', 'imagem', 'outro') then
    raise exception 'Tipo de documento inválido: use prancha, memorial, planilha, desenho, imagem ou outro' using errcode = '22023';
  end if;

  if p ? 'disciplina' and jsonb_typeof(p -> 'disciplina') <> 'null' then
    v_disciplina := p ->> 'disciplina';
    if jsonb_typeof(p -> 'disciplina') <> 'string' or v_disciplina !~ '^[A-Z]{2,4}$' then
      raise exception 'Sigla da disciplina inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ)' using errcode = '22023';
    end if;
  end if;

  v_revisao := p ->> 'revisao';
  if jsonb_typeof(p -> 'revisao') is distinct from 'string' or v_revisao !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$' then
    raise exception 'Revisão inválida: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R07)' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'arquivo_nome') is distinct from 'string'
     or char_length(btrim(p ->> 'arquivo_nome')) not between 1 and 200 then
    raise exception 'O nome do arquivo é obrigatório e tem até 200 caracteres' using errcode = '22023';
  end if;
  v_arquivo := btrim(p ->> 'arquivo_nome');

  v_mime := p ->> 'mime';
  if jsonb_typeof(p -> 'mime') is distinct from 'string' or v_mime not in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/acad', 'image/vnd.dwg', 'application/dxf', 'image/vnd.dxf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream'
  ) then
    raise exception 'Tipo de arquivo (mime) não permitido' using errcode = '22023';
  end if;

  v_bytes := privado.bytes_jsonb(p -> 'bytes', 'bytes');
  if v_bytes > 104857600 then
    raise exception 'O arquivo passa do limite de 100 MB' using errcode = '22023';
  end if;

  v_sha := p ->> 'sha256';
  if jsonb_typeof(p -> 'sha256') is distinct from 'string' or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 do arquivo inválido: são 64 caracteres hexadecimais minúsculos' using errcode = '22023';
  end if;

  v_ext := lower(substring(v_arquivo from '\.([A-Za-z0-9]+)$'));
  if v_ext = 'jpeg' then
    v_ext := 'jpg';
  end if;
  if v_ext is null or v_ext not in ('pdf', 'png', 'jpg', 'webp', 'dwg', 'dxf', 'xlsx', 'docx') then
    raise exception 'Extensão do arquivo não permitida: use pdf, png, jpg, webp, dwg, dxf, xlsx ou docx' using errcode = '22023';
  end if;

  v_caminho := v_obra.id::text || '/' || v_serie::text || '/' || v_sha || '.' || v_ext;
  if (p ->> 'caminho') is distinct from v_caminho then
    raise exception 'Caminho do documento inválido (esperado %)', v_caminho using errcode = '22023';
  end if;

  if exists (select 1 from public.documento d where d.serie = v_serie and d.obra_id <> v_obra.id) then
    raise exception 'Esta série de documento pertence a outra obra' using errcode = '22023';
  end if;
  if exists (select 1 from public.documento d where d.serie = v_serie and d.revisao = v_revisao) then
    raise exception 'A revisão % já existe neste documento', v_revisao using errcode = '23505';
  end if;

  v_achou := privado.arquivo_confirmado('documentos', v_caminho);
  if not v_achou then
    raise exception 'Documento não encontrado no armazenamento (documentos/%): envie o arquivo antes de registrar', v_caminho
      using errcode = 'P0002';
  end if;
  v_tamanho := privado.arquivo_tamanho('documentos', v_caminho)::text;
  if v_tamanho is null or v_tamanho !~ '^\d{1,18}$' then
    raise exception 'Tamanho de documentos/% indisponível: aguarde o fim do envio e tente de novo', v_caminho
      using errcode = '22023';
  end if;
  if v_tamanho::bigint <> v_bytes then
    raise exception 'O arquivo no Storage tem % bytes, e não %: envie o arquivo de novo', v_tamanho, v_bytes
      using errcode = '22023';
  end if;

  insert into public.documento (obra_id, serie, codigo, titulo, tipo, disciplina, revisao, caminho,
                                arquivo_nome, mime, bytes, sha256, enviado_por)
  values (v_obra.id, v_serie, v_codigo, v_titulo, v_tipo, v_disciplina, v_revisao, v_caminho,
          v_arquivo, v_mime, v_bytes, v_sha, auth.uid())
  returning id into v_id;

  return privado.documento_json(v_id);
end;
$$;
revoke execute on function public.admin_registrar_documento(text, jsonb) from public, anon;
grant execute on function public.admin_registrar_documento(text, jsonb) to authenticated;

-- Retirar -----------------------------------------------------------------------------------------

create function public.admin_retirar_documento(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documento;
begin
  perform privado.exigir_admin();
  select * into v_doc from public.documento d where d.id = p_id for update;
  if not found then
    raise exception 'Documento não encontrado' using errcode = 'P0002';
  end if;
  if v_doc.retirado_em is not null then
    raise exception 'Este documento já foi retirado' using errcode = '22023';
  end if;
  update public.documento set retirado_em = now(), retirado_por = auth.uid() where id = p_id;
end;
$$;
revoke execute on function public.admin_retirar_documento(uuid) from public, anon;
grant execute on function public.admin_retirar_documento(uuid) to authenticated;

-- Vincular ----------------------------------------------------------------------------------------

-- p_vinculos: [{tipo, sigla, global_id, classe?, nome?}]. Substitui os vínculos; devolve a lista nova.
create function public.admin_vincular_documento(p_id uuid, p_vinculos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documento;
  v_item jsonb;
  v_tipo text;
  v_sigla text;
  v_gid text;
  v_classe text;
  v_nome text;
begin
  perform privado.exigir_admin();
  select * into v_doc from public.documento d where d.id = p_id for update;
  if not found then
    raise exception 'Documento não encontrado' using errcode = 'P0002';
  end if;
  if v_doc.retirado_em is not null then
    raise exception 'Este documento foi retirado: não é possível alterar os vínculos' using errcode = '22023';
  end if;
  if p_vinculos is null or jsonb_typeof(p_vinculos) <> 'array' then
    raise exception 'Vínculos inválidos: esperado uma lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_vinculos) > 2000 then
    raise exception 'Vínculos demais: no máximo 2000 por documento' using errcode = '22023';
  end if;

  delete from public.documento_vinculo where documento_id = p_id;

  for v_item in select * from jsonb_array_elements(p_vinculos) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Vínculo inválido' using errcode = '22023';
    end if;
    v_tipo := v_item ->> 'tipo';
    if jsonb_typeof(v_item -> 'tipo') is distinct from 'string' or v_tipo not in ('pavimento', 'elemento') then
      raise exception 'Tipo de vínculo inválido: use pavimento ou elemento' using errcode = '22023';
    end if;
    v_sigla := v_item ->> 'sigla';
    if jsonb_typeof(v_item -> 'sigla') is distinct from 'string' or v_sigla !~ '^[A-Z]{2,4}$' then
      raise exception 'Sigla do vínculo inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ)' using errcode = '22023';
    end if;
    v_gid := v_item ->> 'global_id';
    if jsonb_typeof(v_item -> 'global_id') is distinct from 'string' or char_length(v_gid) not between 1 and 64 then
      raise exception 'GlobalId do vínculo inválido: use texto de 1 a 64 caracteres' using errcode = '22023';
    end if;
    v_classe := null;
    v_nome := null;
    if jsonb_typeof(v_item -> 'classe') = 'string' then
      v_classe := left(v_item ->> 'classe', 100);
    end if;
    if jsonb_typeof(v_item -> 'nome') = 'string' then
      v_nome := left(v_item ->> 'nome', 200);
    end if;
    insert into public.documento_vinculo (documento_id, tipo, sigla, global_id, classe, nome)
    values (p_id, v_tipo, v_sigla, v_gid, v_classe, v_nome)
    on conflict (documento_id, sigla, global_id) do nothing;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tipo', v.tipo, 'sigla', v.sigla, 'global_id', v.global_id, 'classe', v.classe, 'nome', v.nome
           ) order by v.sigla, v.global_id)
      from public.documento_vinculo v where v.documento_id = p_id
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_vincular_documento(uuid, jsonb) from public, anon;
grant execute on function public.admin_vincular_documento(uuid, jsonb) to authenticated;

-- Central de obras: passa a contar os documentos --------------------------------------------------

create or replace function public.admin_central_obras()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'obra_id', o.id,
             'slug', o.slug,
             'nome', o.nome,
             -- siglas com modelo publicado vigente (tabela `modelo`)
             'disciplinas', (select count(*) from public.modelo m where m.obra_id = o.id),
             -- séries com revisão vigente (não retirada)
             'documentos', (select count(distinct d.serie) from public.documento d
                             where d.obra_id = o.id and d.retirado_em is null),
             'issues_abertas', 0,
             'atualizado_em', greatest(
               (select max(pm.publicado_em) from public.publicacao_modelo pm where pm.obra_id = o.id),
               (select max(d.enviado_em) from public.documento d where d.obra_id = o.id)
             )
           ) order by o.nome)
      from public.obra o
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_central_obras() from public, anon;
grant execute on function public.admin_central_obras() to authenticated;

-- Varredura de órfãos passa a incluir a pasta `documentos`.
create or replace function privado.varrer_orfaos_storage()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
begin
  create temporary table _orfaos_atuais on commit drop as
  with ref as (
    select 'fotos'::text as bucket, f.storage_path as caminho from public.foto f
    union all select 'plantas', p.imagem_path from public.planta p
    union all select 'plantas', p.imagem_hd_path from public.planta p where p.imagem_hd_path is not null
    union all select 'plantas', d.imagem_path from public.planta_detalhe d
    union all select 'originais', pp.pdf_path from public.publicacao_planta pp
    union all select 'modelos', m.caminho from public.modelo m
    union all select 'modelos', pm.caminho from public.publicacao_modelo pm where pm.caminho is not null
    union all select 'boletins', b.pdf_path from public.boletim b where b.pdf_path is not null
    union all select 'boletins', b.etapa_id::text || '/' || replace(b.numero, '/', '') || '-clima.png'
                from public.boletim b
    union all select 'boletins', regexp_replace(b.pdf_path, '\.pdf$', '') || '-clima.png'
                from public.boletim b where b.pdf_path is not null
    union all select 'organizacao', o.logo_path from public.organizacao o where o.logo_path is not null
    union all select 'documentos', d.caminho from public.documento d
  )
  select a.pasta as bucket, a.caminho as caminho, a.tamanho as tamanho, a.criado_em as criado_em
    from public.arquivo a
   where a.situacao = 'confirmado'
     and a.pasta in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'organizacao', 'relatorios', 'documentos')
     and a.criado_em < now() - interval '7 days'
     and not exists (select 1 from ref r where r.bucket = a.pasta and r.caminho = a.caminho)
     and (a.pasta <> 'relatorios'
          or (privado.uuid_ou_nulo(split_part(a.caminho, '/', 1)) is not null
              and not exists (select 1 from public.obra ob
                               where ob.id = privado.uuid_ou_nulo(split_part(a.caminho, '/', 1)))
              and not exists (select 1 from public.etapa e
                               where e.id = privado.uuid_ou_nulo(split_part(a.caminho, '/', 1)))));

  -- Some da lista o que voltou a ter referência ou deixou de estar confirmado (itens já removidos ficam como histórico).
  delete from public.orfao_storage t
   where t.removido_em is null
     and not exists (select 1 from _orfaos_atuais a where a.bucket = t.bucket and a.caminho = t.caminho);

  insert into public.orfao_storage (bucket, caminho, tamanho, criado_em, origem)
  select a.bucket, a.caminho, a.tamanho, a.criado_em, 'sem_referencia' from _orfaos_atuais a
  on conflict (bucket, caminho) do update
    set tamanho = excluded.tamanho, criado_em = excluded.criado_em
    where public.orfao_storage.removido_em is null;

  select count(*) into v_total from public.orfao_storage where removido_em is null;
  drop table _orfaos_atuais;
  return v_total;
end;
$$;
