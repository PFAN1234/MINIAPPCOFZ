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

-- Parte 1b: funções do banco passam a ler `arquivo` em vez de `storage.objects` ------------------

alter table public.orfao_storage
  add column origem text not null default 'sem_referencia'
  check (origem in ('sem_referencia', 'sem_registro'));

create or replace function privado.exigir_objetos_fotos(p_obra uuid, p_registro uuid, p_fotos jsonb)
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
    if not privado.arquivo_confirmado('fotos', format('%s/%s/%s.jpg', p_obra, p_registro, v_foto.id)) then
      raise exception 'Foto % ainda não foi enviada ao armazenamento', v_foto.id
        using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

create or replace function public.admin_publicar_revisao(p_slug text, p jsonb)
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
    if not privado.arquivo_confirmado('originais', v_pdf_path) then
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
     where not privado.arquivo_confirmado('plantas', c);
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

create or replace function public.admin_registrar_modelo(p_slug text, p jsonb)
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

  v_achou := privado.arquivo_confirmado('modelos', v_caminho);
  if not v_achou then
    raise exception 'Modelo não encontrado no Storage (modelos/%): envie o arquivo antes de registrar', v_caminho
      using errcode = 'P0002';
  end if;
  v_tamanho := privado.arquivo_tamanho('modelos', v_caminho)::text;
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
        hash = excluded.hash, matriz = null, atualizado_em = now()
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

create or replace function public.concluir_emissao(p_id bigint, p_snapshot jsonb, p_pdf_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.boletim_emissao;
  v_boletim public.boletim;
  v_numero text;
  v_caminho text;
begin
  select * into v_pedido from public.boletim_emissao q where q.id = p_id for update;
  if not found then
    raise exception 'Pedido de emissão não encontrado' using errcode = 'P0002';
  end if;
  if v_pedido.estado = 'emitido' then
    select * into v_boletim from public.boletim b where b.id = v_pedido.boletim_id;
    return jsonb_build_object('boletim_id', v_boletim.id, 'numero', v_boletim.numero);
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Snapshot do boletim inválido' using errcode = '22023';
  end if;
  if p_snapshot ->> 'data' is distinct from v_pedido.data::text then
    raise exception 'O snapshot não é do dia do pedido (%)', v_pedido.data using errcode = '22023';
  end if;
  v_numero := privado.numero_boletim(v_pedido.etapa_id, v_pedido.data, v_pedido.revisao);
  v_caminho := v_pedido.etapa_id || '/' || replace(v_numero, '/', '') || '.pdf';
  if p_pdf_path is distinct from v_caminho then
    raise exception 'Caminho do PDF inválido: use %', v_caminho using errcode = '22023';
  end if;
  if not privado.arquivo_confirmado('boletins', v_caminho) then
    raise exception 'O PDF % não foi enviado ao bucket boletins', v_caminho using errcode = '22023';
  end if;

  insert into public.boletim (etapa_id, data, revisao, numero, snapshot, pdf_path, emitido_por,
                              base_boletim_id, edicao)
  values (v_pedido.etapa_id, v_pedido.data, v_pedido.revisao, v_numero, p_snapshot, v_caminho, v_pedido.pedido_por,
          v_pedido.base_boletim_id, v_pedido.edicao)
  returning * into v_boletim;

  update public.boletim_emissao q
     set estado = 'emitido', boletim_id = v_boletim.id, erro = null, atualizado_em = now()
   where q.id = p_id;

  insert into public.publicacao_telegram (boletim_id, estado) values (v_boletim.id, 'pendente');

  if v_pedido.base_boletim_id is not null then
    delete from public.boletim_rascunho r where r.boletim_id = v_pedido.base_boletim_id;
  end if;

  return jsonb_build_object('boletim_id', v_boletim.id, 'numero', v_boletim.numero);
end;
$$;

create or replace function public.admin_salvar_organizacao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_logo text;
  v_cabecalho text[];
  v_org public.organizacao;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da organização inválidos' using errcode = '22023';
  end if;
  if p ? 'nome' and jsonb_typeof(p -> 'nome') <> 'string' then
    raise exception 'O nome precisa ser texto' using errcode = '22023';
  end if;
  if p ? 'logo_path' and jsonb_typeof(p -> 'logo_path') not in ('string', 'null') then
    raise exception 'O caminho do logo precisa ser texto' using errcode = '22023';
  end if;
  v_nome := btrim(p ->> 'nome');
  if p ? 'nome' and (v_nome = '' or char_length(v_nome) > 80) then
    raise exception 'Informe o nome da organização (até 80 caracteres)' using errcode = '22023';
  end if;
  v_logo := p ->> 'logo_path';
  if v_logo is not null then
    if v_logo !~ '^logo-[0-9a-f]{16}\.(png|jpg|webp)$' then
      raise exception 'Caminho do logo inválido: use logo-<16 hex>.<png|jpg|webp>' using errcode = '22023';
    end if;
    if not privado.arquivo_confirmado('organizacao', v_logo) then
      raise exception 'O logo % não foi enviado ao bucket organizacao', v_logo using errcode = '22023';
    end if;
  end if;
  if p ? 'cabecalho' then
    if jsonb_typeof(p -> 'cabecalho') <> 'array'
       or exists (select 1 from jsonb_array_elements(p -> 'cabecalho') l where jsonb_typeof(l) <> 'string') then
      raise exception 'O cabeçalho precisa ser uma lista de linhas de texto' using errcode = '22023';
    end if;
    v_cabecalho := array(
      select btrim(l.linha, E' \t\r\n')
        from jsonb_array_elements_text(p -> 'cabecalho') with ordinality as l(linha, pos)
       order by l.pos
    );
    if cardinality(v_cabecalho) > 4 then
      raise exception 'O cabeçalho pode ter até 4 linhas' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_cabecalho) l where char_length(l) not between 1 and 100) then
      raise exception 'Cada linha do cabeçalho precisa ter de 1 a 100 caracteres' using errcode = '22023';
    end if;
  end if;

  insert into public.organizacao (id) values (true) on conflict (id) do nothing;
  update public.organizacao o
     set nome = coalesce(v_nome, o.nome),
         logo_path = case when p ? 'logo_path' then v_logo else o.logo_path end,
         cabecalho = case when p ? 'cabecalho' then v_cabecalho else o.cabecalho end,
         atualizado_em = now(), atualizado_por = auth.uid()
   where o.id
  returning * into v_org;

  return jsonb_build_object('nome', v_org.nome, 'logo_path', v_org.logo_path, 'cabecalho', to_jsonb(v_org.cabecalho));
end;
$$;

create or replace function privado.resumo_obra(p_obra uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registros', (select count(*) from public.registro r where r.obra_id = p_obra),
    'fotos', (select count(*) from public.foto f where f.obra_id = p_obra),
    'ambientes', (select count(*) from public.ambiente a where a.obra_id = p_obra),
    'pavimentos', (select count(*) from public.pavimento pv where pv.obra_id = p_obra),
    'plantas', (select count(*) from public.planta pl where pl.obra_id = p_obra),
    'modelos', (select count(*) from public.modelo m where m.obra_id = p_obra),
    'participantes', (select count(*) from public.participacao p where p.obra_id = p_obra),
    'publicacoes_telegram', (select count(*) from public.publicacao_telegram pt where pt.obra_id = p_obra),
    'arquivos', (
      select jsonb_object_agg(b.bucket, (
               select count(*) from public.arquivo a
                where a.pasta = b.bucket and a.situacao <> 'excluir'
                  and left(a.caminho, char_length(p_obra::text) + 1) = p_obra::text || '/'
             ))
        from unnest(array['fotos', 'plantas', 'originais', 'modelos']) as b(bucket)
    )
  );
$$;

create or replace function privado.resumo_etapa(p_etapa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with obras as (select o.id from public.obra o where o.etapa_id = p_etapa)
  select jsonb_build_object(
    'registros', (select count(*) from public.registro r where r.obra_id in (select id from obras)),
    'fotos', (select count(*) from public.foto f where f.obra_id in (select id from obras)),
    'ambientes', (select count(*) from public.ambiente a where a.obra_id in (select id from obras)),
    'pavimentos', (select count(*) from public.pavimento pv where pv.obra_id in (select id from obras)),
    'plantas', (select count(*) from public.planta pl where pl.obra_id in (select id from obras)),
    'modelos', (select count(*) from public.modelo m where m.obra_id in (select id from obras)),
    'participantes', (select count(*) from public.participacao p where p.obra_id in (select id from obras)),
    'publicacoes_telegram', (
      select count(*) from public.publicacao_telegram pt where pt.obra_id in (select id from obras)
    ),
    'arquivos', (
      select jsonb_object_agg(b.bucket, (
               select count(*) from public.arquivo a
                where a.pasta = b.bucket and a.situacao <> 'excluir'
                  and exists (select 1 from obras
                               where left(a.caminho, char_length(obras.id::text) + 1) = obras.id::text || '/')
             ))
        from unnest(array['fotos', 'plantas', 'originais', 'modelos']) as b(bucket)
    )
  );
$$;

create or replace function privado.excluir_obra(p_obra uuid, p_etapa_nome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_id uuid;
begin
  select * into v_obra from public.obra o where o.id = p_obra;
  if not found then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;

  insert into public.obra_excluida (obra_id, slug, nome, excluida_por, resumo, etapa_nome)
  values (v_obra.id, v_obra.slug, v_obra.nome, auth.uid(), privado.resumo_obra(v_obra.id), p_etapa_nome)
  returning id into v_id;

  -- registro → ambiente e planta_detalhe → ambiente não têm cascata (o ambiente não pode
  -- ser apagado enquanto tiver histórico). Apaga esses filhos antes, na ordem; o resto sai
  -- pela cascata de obra: registro leva encerramento, foto e publicacao_telegram.
  -- Marca os arquivos da obra no R2 para remoção (a limpeza roda fora do banco).
  perform public.arquivo_marcar_exclusao_prefixo(
    array['fotos', 'plantas', 'originais', 'modelos', 'documentos'], v_obra.id::text || '/');

  delete from public.registro r where r.obra_id = v_obra.id;
  delete from public.planta_detalhe d where d.obra_id = v_obra.id;
  delete from public.obra o where o.id = v_obra.id;
  return v_id;
end;
$$;

create or replace function public.admin_excluir_etapa(p_slug text, p_confirmacao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
  v_resumo jsonb;
  v_obra uuid;
  v_exclusoes uuid[] := '{}';
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  select * into v_etapa from public.etapa e where e.id = v_etapa.id for update;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;

  if p_confirmacao is null or btrim(p_confirmacao) <> btrim(v_etapa.nome) then
    raise exception 'Para excluir, digite exatamente o nome da etapa: %', v_etapa.nome using errcode = '22023';
  end if;

  -- Trava as obras (como admin_excluir_obra) antes de contar.
  perform 1 from public.obra o where o.etapa_id = v_etapa.id order by o.id for update;
  v_resumo := public.admin_resumo_etapa(v_etapa.slug);

  for v_obra in select o.id from public.obra o where o.etapa_id = v_etapa.id order by o.ordem, o.nome, o.id loop
    v_exclusoes := v_exclusoes || privado.excluir_obra(v_obra, v_etapa.nome);
  end loop;
  perform public.arquivo_marcar_exclusao_prefixo(array['boletins'], v_etapa.id::text || '/');
  delete from public.boletim b where b.etapa_id = v_etapa.id;
  delete from public.etapa e where e.id = v_etapa.id;

  return jsonb_build_object('etapa_id', v_etapa.id, 'exclusoes', to_jsonb(v_exclusoes), 'resumo', v_resumo);
end;
$$;

create or replace function public.admin_excluir_boletim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.boletim;
  v_chat bigint;
  v_revisoes int;
  v_mensagens bigint[];
  v_arquivos text[];
begin
  perform privado.exigir_admin();
  select * into v_b from public.boletim b where b.id = p_id;
  if not found then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  -- Serializa com os pedidos da etapa.
  select e.telegram_chat_id into v_chat from public.etapa e where e.id = v_b.etapa_id for update;

  if exists (select 1 from public.boletim_emissao q
              where q.etapa_id = v_b.etapa_id and q.data = v_b.data and q.estado = 'gerando')
     or exists (select 1 from public.publicacao_telegram p
                  join public.boletim x on x.id = p.boletim_id
                 where x.etapa_id = v_b.etapa_id and x.data = v_b.data and p.estado = 'enviando') then
    raise exception 'Há uma emissão ou um envio em andamento para este dia. Tente de novo em alguns minutos.'
      using errcode = '55006';
  end if;

  select count(*) into v_revisoes
    from public.boletim x where x.etapa_id = v_b.etapa_id and x.data = v_b.data;

  select coalesce(array_agg(m order by m), '{}') into v_mensagens
    from public.publicacao_telegram p
    join public.boletim x on x.id = p.boletim_id,
    lateral unnest(p.message_ids) m
   where x.etapa_id = v_b.etapa_id and x.data = v_b.data and m is not null;

  select coalesce(array_agg(a order by a), '{}') into v_arquivos
    from public.boletim x,
    lateral unnest(array[x.pdf_path, regexp_replace(x.pdf_path, '\.pdf$', '') || '-clima.png']) a
   where x.etapa_id = v_b.etapa_id and x.data = v_b.data and x.pdf_path is not null;

  update public.arquivo
     set situacao = 'excluir', atualizado_em = now()
   where pasta = 'boletins' and caminho = any (v_arquivos) and situacao <> 'excluir';

  delete from public.boletim_emissao q where q.etapa_id = v_b.etapa_id and q.data = v_b.data;
  delete from public.boletim x where x.etapa_id = v_b.etapa_id and x.data = v_b.data;

  return jsonb_build_object(
    'numero', v_b.numero,
    'data', v_b.data,
    'etapa_id', v_b.etapa_id,
    'revisoes', v_revisoes,
    'chat_id', v_chat,
    'mensagens', to_jsonb(v_mensagens),
    'arquivos', to_jsonb(v_arquivos)
  );
end;
$$;

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
  )
  select a.pasta as bucket, a.caminho as caminho, a.tamanho as tamanho, a.criado_em as criado_em
    from public.arquivo a
   where a.situacao = 'confirmado'
     and a.pasta in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'organizacao', 'relatorios')
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

-- O 1º segmento do caminho é o id de uma obra existente? (sem storage.foldername)
create or replace function privado.caminho_de_obra(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select position('/' in p_nome) > 0 and exists (
    select 1 from public.obra o
     where o.id = privado.uuid_ou_nulo(split_part(p_nome, '/', 1))
  );
$$;
