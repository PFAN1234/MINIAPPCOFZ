-- Registro dos arquivos guardados no Cloudflare R2 (Parte 1a) ---------------------------------
-- Contrato: docs/contrato-r2.md. Tabela `arquivo`, limites e permissão por pasta (espelho das
-- políticas de storage.objects) e RPCs. As políticas e funções antigas do Storage continuam
-- como estão; a troca delas é a Parte 1b.

create table public.arquivo (
  id bigint generated always as identity primary key,
  pasta text not null check (pasta in
    ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'relatorios', 'organizacao', 'documentos')),
  caminho text not null check (
    char_length(caminho) between 1 and 300
    and caminho !~ '^/'
    and caminho !~ '(^|/)\.\.(/|$)'
  ),
  tamanho bigint not null check (tamanho >= 0),
  tipo text not null,
  autor uuid,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'confirmado', 'excluir')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  confirmado_em timestamptz,
  unique (pasta, caminho)
);

create index arquivo_situacao_idx on public.arquivo (situacao, atualizado_em);
create index arquivo_prefixo_idx on public.arquivo (pasta, caminho text_pattern_ops);

alter table public.arquivo enable row level security;
revoke all on public.arquivo from public, anon, authenticated;
grant select on public.arquivo to authenticated;
create policy arquivo_admin_select on public.arquivo
  for select to authenticated using (privado.eh_admin());

comment on table public.arquivo is
  'Arquivos do R2 (uma linha por pasta e caminho); escrita só pelas RPCs arquivo_*.';

-- Limites por pasta ----------------------------------------------------------------------------

create function privado.limite_pasta(p_pasta text)
returns table (tamanho_max bigint, tipos text[])
language sql
immutable
set search_path = ''
as $$
  select v.tamanho_max, v.tipos
    from (values
      ('fotos',       10::bigint * 1048576,   array['image/jpeg']),
      ('plantas',     5::bigint * 1048576,    array['image/webp']),
      ('originais',   50::bigint * 1048576,   array['application/pdf']),
      ('modelos',     200::bigint * 1048576,  array['application/octet-stream']),
      ('boletins',    10::bigint * 1048576,   array['application/pdf', 'image/png']),
      ('relatorios',  5::bigint * 1073741824, array['application/pdf']),
      ('organizacao', 1::bigint * 1048576,    array['image/png', 'image/jpeg', 'image/webp']),
      ('documentos',  100::bigint * 1048576,  array[
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/acad', 'image/vnd.dwg', 'application/dxf', 'image/vnd.dxf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/octet-stream'])
    ) as v (pasta, tamanho_max, tipos)
   where v.pasta = p_pasta;
$$;
revoke execute on function privado.limite_pasta(text) from public, anon;
grant execute on function privado.limite_pasta(text) to authenticated;

-- Ajudantes ------------------------------------------------------------------------------------

create function privado.arquivo_confirmado(p_pasta text, p_caminho text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.arquivo a
                  where a.pasta = p_pasta and a.caminho = p_caminho and a.situacao = 'confirmado');
$$;
revoke execute on function privado.arquivo_confirmado(text, text) from public, anon;
grant execute on function privado.arquivo_confirmado(text, text) to authenticated;

create function privado.arquivo_tamanho(p_pasta text, p_caminho text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select a.tamanho from public.arquivo a
   where a.pasta = p_pasta and a.caminho = p_caminho and a.situacao = 'confirmado';
$$;
revoke execute on function privado.arquivo_tamanho(text, text) from public, anon;
grant execute on function privado.arquivo_tamanho(text, text) to authenticated;

-- Caminho aceitável em qualquer pasta (sem '/' inicial, sem '..', até 300 caracteres).
create function privado.caminho_arquivo_valido(p_caminho text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_caminho is not null
     and char_length(p_caminho) between 1 and 300
     and p_caminho !~ '^/'
     and p_caminho !~ '(^|/)\.\.(/|$)';
$$;
revoke execute on function privado.caminho_arquivo_valido(text) from public, anon;
grant execute on function privado.caminho_arquivo_valido(text) to authenticated;

-- Permissão ------------------------------------------------------------------------------------

-- Espelho das políticas de storage.objects (estado final). p_acao: ler, enviar, excluir.
create function privado.pode_arquivo(p_acao text, p_pasta text, p_caminho text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_obra uuid;
  v_linha public.arquivo;
begin
  if v_uid is null or p_acao is null or p_pasta is null or p_caminho is null
     or p_acao not in ('ler', 'enviar', 'excluir')
     or not privado.caminho_arquivo_valido(p_caminho) then
    return false;
  end if;

  v_obra := privado.uuid_ou_nulo(split_part(p_caminho, '/', 1));

  case p_pasta
    when 'fotos' then
      if p_acao = 'ler' then
        return privado.eh_participante(v_obra) or privado.eh_admin();
      elsif p_acao = 'enviar' then
        if not (privado.eh_participante(v_obra)
                and p_caminho ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$') then
          return false;
        end if;
        select * into v_linha from public.arquivo a where a.pasta = p_pasta and a.caminho = p_caminho;
        if not found then
          return true;
        end if;
        return v_linha.autor is not distinct from v_uid and not privado.foto_registrada(p_caminho);
      end if;
      return false;

    when 'plantas' then
      if p_acao = 'ler' then
        return privado.eh_participante(v_obra) or privado.eh_admin();
      elsif p_acao = 'enviar' then
        return privado.eh_admin() and privado.caminho_de_obra(p_caminho);
      end if;
      return false;

    when 'originais' then
      if p_acao = 'ler' then
        return privado.eh_admin();
      elsif p_acao = 'enviar' then
        return privado.eh_admin()
          and p_caminho ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,19}/[a-z0-9][a-z0-9-]{0,29}/[0-9a-f]{64}\.pdf$'
          and privado.caminho_de_obra(p_caminho);
      end if;
      return false;

    when 'modelos' then
      if p_acao = 'ler' then
        return privado.eh_participante(v_obra) or privado.eh_admin();
      elsif p_acao = 'enviar' then
        return privado.eh_admin()
          and p_caminho ~ '^[0-9a-f-]{36}/[A-Z]{2,4}/[0-9a-f]{16}\.frag$'
          and privado.caminho_de_obra(p_caminho);
      end if;
      return false;

    when 'boletins' then
      if p_acao = 'ler' then
        return privado.eh_admin() or privado.participa_da_etapa(v_obra);
      end if;
      return false;

    when 'relatorios' then
      return false;

    when 'organizacao' then
      if p_acao = 'ler' then
        return true;
      elsif p_acao = 'enviar' then
        return privado.eh_admin() and p_caminho ~ '^logo-[0-9a-f]{16}\.(png|jpg|webp)$';
      end if;
      return privado.eh_admin();  -- excluir

    when 'documentos' then
      if p_acao = 'ler' then
        return privado.eh_admin();
      elsif p_acao = 'enviar' then
        return privado.eh_admin()
          and p_caminho ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(pdf|png|jpg|webp|dwg|dxf|xlsx|docx)$'
          and privado.caminho_de_obra(p_caminho);
      end if;
      return false;

    else
      return false;
  end case;
end;
$$;
revoke execute on function privado.pode_arquivo(text, text, text) from public, anon;
grant execute on function privado.pode_arquivo(text, text, text) to authenticated;

-- RPCs para authenticated ----------------------------------------------------------------------

create function public.arquivo_preparar_envio(p_pasta text, p_caminho text, p_tamanho bigint, p_tipo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lim record;
  v_linha public.arquivo;
  v_existe boolean;
begin
  if v_uid is null then
    raise exception 'sem_sessao' using errcode = '28000';
  end if;
  if p_pasta is null or p_caminho is null
     or p_pasta not in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'relatorios', 'organizacao', 'documentos')
     or not privado.caminho_arquivo_valido(p_caminho) then
    raise exception 'caminho_invalido' using errcode = '22023';
  end if;

  -- Foto já vinculada a um registro: o reenvio não é erro, o arquivo já está lá.
  if p_pasta = 'fotos'
     and privado.eh_participante(privado.uuid_ou_nulo(split_part(p_caminho, '/', 1)))
     and p_caminho ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
     and privado.foto_registrada(p_caminho) then
    return 'ja_confirmado';
  end if;

  select * into v_linha from public.arquivo a
   where a.pasta = p_pasta and a.caminho = p_caminho for update;
  v_existe := found;
  if v_existe and v_linha.situacao = 'excluir' then
    raise exception 'em_exclusao' using errcode = '22023';
  end if;

  if not privado.pode_arquivo('enviar', p_pasta, p_caminho) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- Os caminhos não se repetem com conteúdo diferente (UUID, hash ou revisão no nome): um
  -- arquivo confirmado nunca volta a pendente, senão poderia sumir de quem já o usa.
  if v_existe and v_linha.situacao = 'confirmado' then
    return 'ja_confirmado';
  end if;

  select * into v_lim from privado.limite_pasta(p_pasta);
  if p_tamanho is null or p_tamanho < 0 or p_tamanho > v_lim.tamanho_max
     or p_tipo is null or not (p_tipo = any (v_lim.tipos)) then
    raise exception 'fora_do_limite' using errcode = '22023';
  end if;

  -- Linha nova conta no limite de 300 pendentes por usuário.
  if not v_existe then
    if (select count(*) from public.arquivo a where a.autor = v_uid and a.situacao = 'pendente') >= 300 then
      raise exception 'fora_do_limite' using errcode = '22023';
    end if;
  end if;

  if not v_existe then
    insert into public.arquivo (pasta, caminho, tamanho, tipo, autor)
    values (p_pasta, p_caminho, p_tamanho, p_tipo, v_uid);
  else
    update public.arquivo
       set tamanho = p_tamanho, tipo = p_tipo, autor = v_uid, atualizado_em = now()
     where id = v_linha.id;
  end if;
  return 'enviar';
end;
$$;

create function public.arquivo_pode_ler(p_itens jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao' using errcode = '28000';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'caminho_invalido' using errcode = '22023';
  end if;
  if jsonb_array_length(p_itens) > 200 then
    raise exception 'fora_do_limite' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('pasta', i.pasta, 'caminho', i.caminho)), '[]'::jsonb)
    into v_resultado
    from (select e.value ->> 'pasta' as pasta, e.value ->> 'caminho' as caminho
            from jsonb_array_elements(p_itens) as e) i
   where i.pasta is not null and i.caminho is not null
     and privado.arquivo_confirmado(i.pasta, i.caminho)
     and privado.pode_arquivo('ler', i.pasta, i.caminho);
  return v_resultado;
end;
$$;

create function public.arquivo_marcar_exclusao(p_pasta text, p_caminho text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sem_sessao' using errcode = '28000';
  end if;
  if not privado.pode_arquivo('excluir', p_pasta, p_caminho) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update public.arquivo
     set situacao = 'excluir', atualizado_em = now()
   where pasta = p_pasta and caminho = p_caminho and situacao <> 'excluir';
end;
$$;

-- RPCs só para service_role --------------------------------------------------------------------

create function public.arquivo_confirmar(p_pasta text, p_caminho text, p_tamanho bigint, p_tipo text, p_autor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.arquivo;
begin
  select * into v_linha from public.arquivo a
   where a.pasta = p_pasta and a.caminho = p_caminho and a.situacao = 'pendente'
     and (p_autor is null or a.autor = p_autor)
   for update;
  if not found then
    return 'nao_encontrado';
  end if;
  if v_linha.tamanho <> p_tamanho or v_linha.tipo <> p_tipo then
    return 'divergente';
  end if;
  update public.arquivo
     set situacao = 'confirmado', confirmado_em = now(), atualizado_em = now()
   where id = v_linha.id;
  return 'confirmado';
end;
$$;

create function public.arquivo_registrar_servico(p_pasta text, p_caminho text, p_tamanho bigint, p_tipo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim record;
begin
  if p_pasta is null or p_caminho is null
     or p_pasta not in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'relatorios', 'organizacao', 'documentos')
     or not privado.caminho_arquivo_valido(p_caminho) then
    raise exception 'caminho_invalido' using errcode = '22023';
  end if;
  select * into v_lim from privado.limite_pasta(p_pasta);
  if p_tamanho is null or p_tamanho < 0 or p_tamanho > v_lim.tamanho_max
     or p_tipo is null or not (p_tipo = any (v_lim.tipos)) then
    raise exception 'fora_do_limite' using errcode = '22023';
  end if;
  insert into public.arquivo (pasta, caminho, tamanho, tipo, autor, situacao, confirmado_em)
  values (p_pasta, p_caminho, p_tamanho, p_tipo, null, 'confirmado', now())
  on conflict (pasta, caminho) do update
    set tamanho = excluded.tamanho, tipo = excluded.tipo, autor = null,
        situacao = 'confirmado', confirmado_em = now(), atualizado_em = now();
end;
$$;

create function public.arquivo_fila_manutencao(p_limite int default 500)
returns setof public.arquivo
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.arquivo a
   where a.situacao = 'excluir'
      or (a.situacao = 'pendente' and a.atualizado_em < now() - interval '7 days')
   order by a.atualizado_em, a.id
   limit greatest(coalesce(p_limite, 500), 0);
$$;

create function public.arquivo_remover(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.arquivo where id = any (p_ids);
$$;

create function public.arquivo_marcar_exclusao_prefixo(p_pastas text[], p_prefixo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_prefixo is null or p_prefixo = '' then
    raise exception 'caminho_invalido' using errcode = '22023';
  end if;
  update public.arquivo
     set situacao = 'excluir', atualizado_em = now()
   where pasta = any (p_pastas)
     and left(caminho, char_length(p_prefixo)) = p_prefixo
     and situacao <> 'excluir';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function public.arquivo_sem_registro(p_chaves text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(k.chave order by k.chave), '{}'::text[])
    from unnest(p_chaves) as k (chave)
   where not exists (select 1 from public.arquivo a where a.pasta || '/' || a.caminho = k.chave);
$$;

-- Permissões das RPCs -------------------------------------------------------------------------

revoke execute on function public.arquivo_preparar_envio(text, text, bigint, text) from public, anon;
revoke execute on function public.arquivo_pode_ler(jsonb) from public, anon;
revoke execute on function public.arquivo_marcar_exclusao(text, text) from public, anon;
grant execute on function public.arquivo_preparar_envio(text, text, bigint, text) to authenticated;
grant execute on function public.arquivo_pode_ler(jsonb) to authenticated;
grant execute on function public.arquivo_marcar_exclusao(text, text) to authenticated;

revoke execute on function public.arquivo_confirmar(text, text, bigint, text, uuid) from public, anon, authenticated;
revoke execute on function public.arquivo_registrar_servico(text, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.arquivo_fila_manutencao(int) from public, anon, authenticated;
revoke execute on function public.arquivo_remover(bigint[]) from public, anon, authenticated;
revoke execute on function public.arquivo_marcar_exclusao_prefixo(text[], text) from public, anon, authenticated;
revoke execute on function public.arquivo_sem_registro(text[]) from public, anon, authenticated;
grant execute on function public.arquivo_confirmar(text, text, bigint, text, uuid) to service_role;
grant execute on function public.arquivo_registrar_servico(text, text, bigint, text) to service_role;
grant execute on function public.arquivo_fila_manutencao(int) to service_role;
grant execute on function public.arquivo_remover(bigint[]) to service_role;
grant execute on function public.arquivo_marcar_exclusao_prefixo(text[], text) to service_role;
grant execute on function public.arquivo_sem_registro(text[]) to service_role;
