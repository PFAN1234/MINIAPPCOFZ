-- Site de administração, fase 3: modelo 3D (.frag) publicado pelo navegador do admin.
-- Plano: tasks/plano-admin.md ("Fase 3: modelo (IFC)"); documentação: docs/admin.md.
--
-- - Admin grava (insert/update) no bucket `modelos`, em <obra_id>/<SIGLA>/<hash16>.frag: o
--   caminho é endereçado pelo conteúdo (um arquivo novo nunca sobrescreve o que os aparelhos
--   já baixaram). O caminho antigo do script `publicar_modelos`, <obra_id>/<SIGLA>.frag,
--   continua válido na tabela `modelo`. Sem delete: o arquivo retirado fica no Storage.
-- - `publicacao_modelo`: histórico das publicações e retiradas (quem, quando, arquivo).
-- - RPCs `admin_registrar_modelo`, `admin_listar_modelos` e `admin_retirar_modelo`.

-- Bucket `modelos`: admin lê tudo e grava nas pastas das obras. A leitura dos participantes
-- (`modelos_select`) não muda; o upsert do Storage exige select, insert e update.

create policy modelos_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'modelos' and privado.eh_admin());

create policy modelos_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'modelos'
    and privado.eh_admin()
    and name ~ '^[0-9a-f-]{36}/[A-Z]{2,4}/[0-9a-f]{16}\.frag$'
    and privado.caminho_de_obra(name)
  );

create policy modelos_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'modelos' and privado.eh_admin())
  with check (
    bucket_id = 'modelos'
    and privado.eh_admin()
    and name ~ '^[0-9a-f-]{36}/[A-Z]{2,4}/[0-9a-f]{16}\.frag$'
    and privado.caminho_de_obra(name)
  );

-- Histórico das publicações ---------------------------------------------------------------------

create table public.publicacao_modelo (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  acao text not null,
  sigla text not null,
  revisao text,
  caminho text,
  bytes bigint,
  hash text,
  -- 'ifc': convertido no navegador; 'frag': .frag enviado pronto. Null nas retiradas.
  origem text,
  arquivo_nome text,
  ifc_bytes bigint,
  publicado_por uuid references public.usuario (id) on delete set null,
  publicado_em timestamptz not null default now(),
  constraint publicacao_modelo_acao check (acao in ('publicado', 'retirado')),
  constraint publicacao_modelo_sigla check (sigla ~ '^[A-Z]{2,4}$'),
  constraint publicacao_modelo_origem check (origem in ('ifc', 'frag')),
  constraint publicacao_modelo_bytes check (bytes > 0),
  constraint publicacao_modelo_ifc_bytes check (ifc_bytes > 0)
);
create index publicacao_modelo_obra_idx on public.publicacao_modelo (obra_id, publicado_em desc);
alter table public.publicacao_modelo enable row level security;
revoke all on public.publicacao_modelo from public, anon, authenticated;

comment on table public.publicacao_modelo is
  'Publicações e retiradas de modelo 3D feitas pelo site de administração; leitura só por admin, via RPC.';

-- Auxiliares de validação -----------------------------------------------------------------------

-- Inteiro positivo de 64 bits (tamanho em bytes). Null se ausente e permitido; 22023 se inválido.
create function privado.bytes_jsonb(p_valor jsonb, p_campo text, p_nulo boolean default false)
returns bigint
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
  if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}') !~ '^\d{1,18}$' or (p_valor #>> '{}')::bigint <= 0 then
    raise exception 'O campo % precisa ser um inteiro positivo', p_campo using errcode = '22023';
  end if;
  return (p_valor #>> '{}')::bigint;
end;
$$;
revoke execute on function privado.bytes_jsonb(jsonb, text, boolean) from public, anon, authenticated;

-- Registrar ------------------------------------------------------------------------------------

-- Payload (o site monta depois do upload em `modelos`):
-- {
--   "sigla": "ARQ", "revisao": "R03" | null,
--   "caminho": "<obra_id>/ARQ/<hash>.frag", "hash": "<16 hex>", "bytes": n,
--   "origem": "ifc" | "frag", "arquivo_nome": "ARQ-R03.ifc", "ifc_bytes": n   -- os dois opcionais
-- }
-- Retorno: {sigla, revisao, caminho, bytes, hash, atualizado_em}.
create function public.admin_registrar_modelo(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_sigla text;
  v_revisao text;
  v_hash text;
  v_caminho text;
  v_bytes bigint;
  v_ifc_bytes bigint;
  v_origem text;
  v_arquivo text;
  v_meta jsonb;
  v_achou boolean;
  v_tamanho text;
  v_modelo public.modelo;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  -- Serializa publicações e edições da mesma obra.
  perform 1 from public.obra o where o.id = v_obra.id for update;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados do modelo inválidos' using errcode = '22023';
  end if;

  v_sigla := p ->> 'sigla';
  if jsonb_typeof(p -> 'sigla') is distinct from 'string' or v_sigla !~ '^[A-Z]{2,4}$' then
    raise exception 'Sigla da disciplina inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ)' using errcode = '22023';
  end if;

  if p ? 'revisao' and jsonb_typeof(p -> 'revisao') <> 'null' then
    v_revisao := p ->> 'revisao';
    if jsonb_typeof(p -> 'revisao') <> 'string' or v_revisao !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$' then
      raise exception 'Revisão inválida: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R07)' using errcode = '22023';
    end if;
  end if;

  v_hash := p ->> 'hash';
  if jsonb_typeof(p -> 'hash') is distinct from 'string' or v_hash !~ '^[0-9a-f]{16}$' then
    raise exception 'Hash do modelo inválido: são 16 caracteres hexadecimais minúsculos' using errcode = '22023';
  end if;

  v_bytes := privado.bytes_jsonb(p -> 'bytes', 'bytes');
  v_ifc_bytes := privado.bytes_jsonb(p -> 'ifc_bytes', 'ifc_bytes', true);

  v_origem := p ->> 'origem';
  if jsonb_typeof(p -> 'origem') is distinct from 'string' or v_origem not in ('ifc', 'frag') then
    raise exception 'Origem inválida: use ifc ou frag' using errcode = '22023';
  end if;

  if p ? 'arquivo_nome' and jsonb_typeof(p -> 'arquivo_nome') <> 'null' then
    if jsonb_typeof(p -> 'arquivo_nome') <> 'string' or char_length(p ->> 'arquivo_nome') > 200 then
      raise exception 'O nome do arquivo precisa ser texto de até 200 caracteres' using errcode = '22023';
    end if;
    v_arquivo := nullif(btrim(p ->> 'arquivo_nome'), '');
  end if;

  v_caminho := v_obra.id::text || '/' || v_sigla || '/' || v_hash || '.frag';
  if (p ->> 'caminho') is distinct from v_caminho then
    raise exception 'Caminho do modelo inválido (esperado %)', v_caminho using errcode = '22023';
  end if;

  select true, o.metadata into v_achou, v_meta
    from storage.objects o where o.bucket_id = 'modelos' and o.name = v_caminho;
  if v_achou is null then
    raise exception 'Modelo não encontrado no Storage (modelos/%): envie o arquivo antes de registrar', v_caminho
      using errcode = 'P0002';
  end if;
  v_tamanho := v_meta ->> 'size';
  if v_tamanho is null or v_tamanho !~ '^\d{1,18}$' then
    raise exception 'O Storage ainda não informou o tamanho de modelos/%: aguarde o fim do envio e tente de novo', v_caminho
      using errcode = '22023';
  end if;
  if v_tamanho::bigint <> v_bytes then
    raise exception 'O arquivo no Storage tem % bytes, e não %: envie o arquivo de novo', v_tamanho, v_bytes
      using errcode = '22023';
  end if;

  insert into public.modelo (obra_id, sigla, revisao, caminho, bytes, hash)
  values (v_obra.id, v_sigla, v_revisao, v_caminho, v_bytes, v_hash)
  on conflict (obra_id, sigla) do update
    set revisao = excluded.revisao, caminho = excluded.caminho, bytes = excluded.bytes,
        hash = excluded.hash, atualizado_em = now()
  returning * into v_modelo;

  insert into public.publicacao_modelo (obra_id, acao, sigla, revisao, caminho, bytes, hash, origem,
                                        arquivo_nome, ifc_bytes, publicado_por)
  values (v_obra.id, 'publicado', v_sigla, v_revisao, v_caminho, v_bytes, v_hash, v_origem,
          v_arquivo, v_ifc_bytes, auth.uid());

  return jsonb_build_object(
    'sigla', v_modelo.sigla, 'revisao', v_modelo.revisao, 'caminho', v_modelo.caminho,
    'bytes', v_modelo.bytes, 'hash', v_modelo.hash, 'atualizado_em', v_modelo.atualizado_em
  );
end;
$$;

-- Listar: modelos atuais (por sigla) e as últimas 100 publicações/retiradas (mais recente primeiro).
create function public.admin_listar_modelos(p_slug text)
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
    'modelos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sigla', m.sigla, 'revisao', m.revisao, 'caminho', m.caminho, 'bytes', m.bytes,
               'hash', m.hash, 'atualizado_em', m.atualizado_em
             ) order by m.sigla)
        from public.modelo m where m.obra_id = v_obra.id
    ), '[]'::jsonb),
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'acao', h.acao, 'sigla', h.sigla, 'revisao', h.revisao, 'bytes', h.bytes,
               'hash', h.hash, 'origem', h.origem, 'arquivo_nome', h.arquivo_nome, 'ifc_bytes', h.ifc_bytes,
               'publicado_em', h.publicado_em, 'publicado_por_nome', h.publicado_por_nome
             ) order by h.publicado_em desc, h.id)
        from (
          select pm.*, u.nome as publicado_por_nome
            from public.publicacao_modelo pm
            left join public.usuario u on u.id = pm.publicado_por
           where pm.obra_id = v_obra.id
           order by pm.publicado_em desc, pm.id
           limit 100
        ) h
    ), '[]'::jsonb)
  );
end;
$$;

-- Retirar: tira o modelo da obra (os aparelhos deixam de vê-lo). O arquivo fica no Storage.
create function public.admin_retirar_modelo(p_slug text, p_sigla text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_modelo public.modelo;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  perform 1 from public.obra o where o.id = v_obra.id for update;

  delete from public.modelo m where m.obra_id = v_obra.id and m.sigla = p_sigla
  returning * into v_modelo;
  if v_modelo.id is null then
    raise exception 'Não há modelo publicado com a sigla % nesta obra', coalesce(p_sigla, '(vazia)')
      using errcode = 'P0002';
  end if;

  insert into public.publicacao_modelo (obra_id, acao, sigla, revisao, caminho, bytes, hash, publicado_por)
  values (v_obra.id, 'retirado', v_modelo.sigla, v_modelo.revisao, v_modelo.caminho, v_modelo.bytes,
          v_modelo.hash, auth.uid());
end;
$$;

revoke execute on function public.admin_registrar_modelo(text, jsonb) from public, anon;
revoke execute on function public.admin_listar_modelos(text) from public, anon;
revoke execute on function public.admin_retirar_modelo(text, text) from public, anon;
grant execute on function public.admin_registrar_modelo(text, jsonb) to authenticated;
grant execute on function public.admin_listar_modelos(text) to authenticated;
grant execute on function public.admin_retirar_modelo(text, text) to authenticated;
