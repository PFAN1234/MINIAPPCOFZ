-- Fase 2: RPCs de escrita (security definer) e auxiliares de validação.

-- Valida e normaliza a lista de fotos enviada pelo cliente.
-- Aceita só {id, largura, altura, bytes}; o caminho nunca vem do cliente.
create function privado.normalizar_fotos(p_fotos jsonb)
returns table (ordem int, id uuid, largura int, altura int, bytes int)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_pos int := 0;
  v_campo text;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' then
    raise exception 'A lista de fotos é inválida' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fotos) not between 1 and 10 then
    raise exception 'Envie de 1 a 10 fotos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_fotos) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'id') <> 'string'
       or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Foto % com identificador inválido', v_pos + 1 using errcode = '22023';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    if v_id = any (v_ids) then
      raise exception 'Identificador de foto repetido' using errcode = '22023';
    end if;
    v_ids := v_ids || v_id;

    foreach v_campo in array array['largura', 'altura', 'bytes'] loop
      if jsonb_typeof(v_item -> v_campo) <> 'number'
         or (v_item ->> v_campo) !~ '^[1-9][0-9]{0,8}$' then
        raise exception 'Foto %: % deve ser um inteiro positivo', v_pos + 1, v_campo
          using errcode = '22023';
      end if;
    end loop;

    ordem := v_pos;
    id := v_id;
    largura := (v_item ->> 'largura')::int;
    altura := (v_item ->> 'altura')::int;
    bytes := (v_item ->> 'bytes')::int;
    v_pos := v_pos + 1;
    return next;
  end loop;
end;
$$;

-- Garante que todos os objetos das fotos existem no Storage.
create function privado.exigir_objetos_fotos(p_obra uuid, p_registro uuid, p_fotos jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_foto record;
begin
  for v_foto in select f.id from privado.normalizar_fotos(p_fotos) f loop
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'fotos'
        and o.name = format('%s/%s/%s.jpg', p_obra, p_registro, v_foto.id)
    ) then
      raise exception 'Foto % ainda não foi enviada ao armazenamento', v_foto.id
        using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

create function public.concluir_registro(
  p_id uuid,
  p_ambiente_id uuid,
  p_tipo text,
  p_legenda text,
  p_capturado_em timestamptz,
  p_fotos jsonb
)
returns public.registro
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_obra uuid;
  v_legenda text;
  v_reg public.registro;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if p_id is null or p_ambiente_id is null then
    raise exception 'Identificadores obrigatórios' using errcode = '22023';
  end if;

  select a.obra_id into v_obra from public.ambiente a where a.id = p_ambiente_id;
  if v_obra is null then
    raise exception 'Ambiente não encontrado' using errcode = 'P0002';
  end if;
  if not privado.eh_participante(v_obra) then
    raise exception 'Sem permissão nesta obra' using errcode = '42501';
  end if;

  -- Idempotência: mesma chamada repetida devolve o registro existente.
  select * into v_reg from public.registro r where r.id = p_id;
  if found then
    if v_reg.autor_id = v_uid and v_reg.ambiente_id = p_ambiente_id then
      return v_reg;
    end if;
    raise exception 'registro_id em uso' using errcode = '23505';
  end if;

  if p_tipo is null or p_tipo not in ('servico', 'pendencia') then
    raise exception 'Tipo de registro inválido' using errcode = '22023';
  end if;
  -- btrim só remove espaços; aparar também tabulações e quebras de linha.
  v_legenda := regexp_replace(p_legenda, '^\s+|\s+$', '', 'g');
  if v_legenda is null or char_length(v_legenda) not between 1 and 1000 then
    raise exception 'A legenda deve ter de 1 a 1000 caracteres' using errcode = '22023';
  end if;
  if p_capturado_em is null or p_capturado_em > now() + interval '5 minutes' then
    raise exception 'Data de captura inválida' using errcode = '22023';
  end if;

  perform privado.exigir_objetos_fotos(v_obra, p_id, p_fotos);

  insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em, situacao)
  values (
    p_id, v_obra, p_ambiente_id, p_tipo, v_legenda, v_uid, p_capturado_em,
    case when p_tipo = 'pendencia' then 'aberta' end
  )
  on conflict (id) do nothing
  returning * into v_reg;

  if not found then
    -- Outra chamada simultânea inseriu primeiro (e já confirmou): reavalia.
    select * into v_reg from public.registro r where r.id = p_id;
    if found and v_reg.autor_id = v_uid and v_reg.ambiente_id = p_ambiente_id then
      return v_reg;
    end if;
    raise exception 'registro_id em uso' using errcode = '23505';
  end if;

  insert into public.foto (id, obra_id, registro_id, storage_path, largura, altura, bytes, ordem)
  select f.id, v_obra, p_id, format('%s/%s/%s.jpg', v_obra, p_id, f.id),
         f.largura, f.altura, f.bytes, f.ordem
  from privado.normalizar_fotos(p_fotos) f;

  insert into public.publicacao_telegram (obra_id, registro_id, estado)
  values (v_obra, p_id, 'pendente');

  return v_reg;
end;
$$;

create function public.encerrar_pendencia(
  p_id uuid,
  p_registro_id uuid,
  p_observacao text,
  p_fotos jsonb
)
returns public.encerramento
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_obra uuid;
  v_reg public.registro;
  v_enc public.encerramento;
  v_obs text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if p_id is null or p_registro_id is null then
    raise exception 'Identificadores obrigatórios' using errcode = '22023';
  end if;

  -- Autoriza antes de travar a linha, para não permitir bloqueio por quem não é gestor.
  select r.obra_id into v_obra from public.registro r where r.id = p_registro_id;
  if v_obra is null then
    raise exception 'Registro não encontrado' using errcode = 'P0002';
  end if;
  if not privado.eh_gestor(v_obra) then
    raise exception 'Apenas gestores da obra podem encerrar pendências' using errcode = '42501';
  end if;

  select * into v_reg from public.registro r where r.id = p_registro_id for update;
  if v_reg.tipo <> 'pendencia' then
    raise exception 'Só pendências podem ser encerradas' using errcode = '22023';
  end if;

  -- Idempotência (depois do bloqueio, para enxergar o resultado de quem chegou antes).
  select * into v_enc from public.encerramento e where e.id = p_id;
  if found then
    if v_enc.registro_id = p_registro_id and v_enc.gestor_id = v_uid then
      return v_enc;
    end if;
    raise exception 'encerramento_id em uso' using errcode = '23505';
  end if;
  if v_reg.situacao = 'resolvida' then
    raise exception 'pendência já encerrada' using errcode = '23505';
  end if;

  v_obs := nullif(regexp_replace(p_observacao, '^\s+|\s+$', '', 'g'), '');
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'A observação deve ter até 1000 caracteres' using errcode = '22023';
  end if;

  perform privado.exigir_objetos_fotos(v_obra, p_registro_id, p_fotos);

  insert into public.encerramento (id, registro_id, obra_id, gestor_id, observacao)
  values (p_id, p_registro_id, v_obra, v_uid, v_obs)
  returning * into v_enc;

  insert into public.foto (id, obra_id, encerramento_id, storage_path, largura, altura, bytes, ordem)
  select f.id, v_obra, p_id, format('%s/%s/%s.jpg', v_obra, p_registro_id, f.id),
         f.largura, f.altura, f.bytes, f.ordem
  from privado.normalizar_fotos(p_fotos) f;

  update public.registro set situacao = 'resolvida' where id = p_registro_id;

  insert into public.publicacao_telegram (obra_id, encerramento_id, estado)
  values (v_obra, p_id, 'pendente');

  return v_enc;
end;
$$;

revoke execute on function privado.normalizar_fotos(jsonb) from public, anon;
revoke execute on function privado.exigir_objetos_fotos(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.concluir_registro(uuid, uuid, text, text, timestamptz, jsonb) from public, anon;
revoke execute on function public.encerrar_pendencia(uuid, uuid, text, jsonb) from public, anon;

grant execute on function public.concluir_registro(uuid, uuid, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.encerrar_pendencia(uuid, uuid, text, jsonb) to authenticated;
