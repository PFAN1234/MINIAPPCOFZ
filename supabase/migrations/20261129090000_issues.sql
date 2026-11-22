-- Central de modelos, etapa 7A: Issues (problemas, dúvidas, conflitos e pendências ligadas ao modelo).
-- - `issue`: numerada por obra (`numero`), com `guid` estável para o intercâmbio BCF.
-- - `issue_vista`: ponto de vista da câmera (jsonb) e, opcionalmente, a imagem (pasta `issues` do R2,
--   <obra_id>/<issue_id>/<vista_id>.png).
-- - `issue_comentario`: comentários da issue, opcionalmente ligados a uma vista.
-- - Sem acesso direto às tabelas: toda leitura e escrita passa pelas RPCs `admin_*_issue*` (só admin).
-- - Pasta `issues` no R2: 5 MB, só image/png; ler e enviar só admin; sem exclusão (sai com a obra).
--   Redefine `limite_pasta`, `pode_arquivo`, `arquivo_preparar_envio`, `arquivo_registrar_servico`,
--   `excluir_obra` e `varrer_orfaos_storage` (cópias das versões vigentes, mudando só o necessário).
-- - `admin_central_obras` passa a contar as issues abertas.

-- Tabelas -----------------------------------------------------------------------------------------

create table public.issue (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  numero int not null,
  guid uuid not null default gen_random_uuid(),
  titulo text not null,
  descricao text,
  tipo text not null default 'problema',          -- problema | duvida | conflito | pendencia
  prioridade text not null default 'normal',      -- baixa | normal | alta | critica
  status text not null default 'aberta',          -- aberta | em_andamento | resolvida | fechada
  responsavel_id uuid references public.usuario (id) on delete set null,
  prazo date,
  criado_por uuid references public.usuario (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (obra_id, numero),
  unique (guid),
  constraint issue_titulo check (char_length(titulo) between 1 and 200),
  constraint issue_tipo check (tipo in ('problema', 'duvida', 'conflito', 'pendencia')),
  constraint issue_prioridade check (prioridade in ('baixa', 'normal', 'alta', 'critica')),
  constraint issue_status check (status in ('aberta', 'em_andamento', 'resolvida', 'fechada'))
);
create index issue_obra_idx on public.issue (obra_id);

create table public.issue_vista (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issue (id) on delete cascade,
  guid uuid not null default gen_random_uuid(),
  vista jsonb not null,
  imagem_path text,                    -- caminho dentro da pasta issues: <obra_id>/<issue_id>/<vista_id>.png
  criado_em timestamptz not null default now(),
  unique (guid)
);
create index issue_vista_issue_idx on public.issue_vista (issue_id);

create table public.issue_comentario (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issue (id) on delete cascade,
  guid uuid not null default gen_random_uuid(),
  autor_id uuid references public.usuario (id) on delete set null,
  texto text not null,
  vista_id uuid references public.issue_vista (id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (guid),
  constraint issue_comentario_texto check (char_length(texto) between 1 and 5000)
);
create index issue_comentario_issue_idx on public.issue_comentario (issue_id);

alter table public.issue enable row level security;
alter table public.issue_vista enable row level security;
alter table public.issue_comentario enable row level security;

revoke all on public.issue from public, anon, authenticated;
revoke all on public.issue_vista from public, anon, authenticated;
revoke all on public.issue_comentario from public, anon, authenticated;

comment on table public.issue is
  'Issues da obra (numeradas por obra, com guid BCF); sem acesso direto, só pelas RPCs admin_*_issue*.';

-- Pasta `issues` no R2 ---------------------------------------------------------------------------

alter table public.arquivo drop constraint arquivo_pasta_check;
alter table public.arquivo add constraint arquivo_pasta_check check (pasta in
  ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'relatorios', 'organizacao', 'documentos', 'issues'));

create or replace function privado.limite_pasta(p_pasta text)
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
        'application/octet-stream']),
      ('issues',      5::bigint * 1048576,    array['image/png'])
    ) as v (pasta, tamanho_max, tipos)
   where v.pasta = p_pasta;
$$;

create or replace function privado.pode_arquivo(p_acao text, p_pasta text, p_caminho text)
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

    when 'issues' then
      if p_acao = 'ler' then
        return privado.eh_admin();
      elsif p_acao = 'enviar' then
        return privado.eh_admin()
          and p_caminho ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$'
          and privado.caminho_de_obra(p_caminho);
      end if;
      return false;

    else
      return false;
  end case;
end;
$$;

create or replace function public.arquivo_preparar_envio(p_pasta text, p_caminho text, p_tamanho bigint, p_tipo text)
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
     or p_pasta not in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'relatorios', 'organizacao', 'documentos', 'issues')
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

create or replace function public.arquivo_registrar_servico(p_pasta text, p_caminho text, p_tamanho bigint, p_tipo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim record;
begin
  if p_pasta is null or p_caminho is null
     or p_pasta not in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'relatorios', 'organizacao', 'documentos', 'issues')
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
    array['fotos', 'plantas', 'originais', 'modelos', 'documentos', 'issues'], v_obra.id::text || '/');

  delete from public.registro r where r.obra_id = v_obra.id;
  delete from public.planta_detalhe d where d.obra_id = v_obra.id;
  delete from public.obra o where o.id = v_obra.id;
  return v_id;
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
    union all select 'documentos', d.caminho from public.documento d
    union all select 'issues', v.imagem_path from public.issue_vista v where v.imagem_path is not null
  )
  select a.pasta as bucket, a.caminho as caminho, a.tamanho as tamanho, a.criado_em as criado_em
    from public.arquivo a
   where a.situacao = 'confirmado'
     and a.pasta in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'organizacao', 'relatorios', 'documentos', 'issues')
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


-- Auxiliares --------------------------------------------------------------------------------------

create function privado.uuid_texto_valido(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;
revoke execute on function privado.uuid_texto_valido(text) from public, anon, authenticated;

-- Próximo número da issue na obra, serializado por obra (lock consultivo até o fim da transação).
create function privado.proximo_numero_issue(p_obra uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('issue:' || p_obra::text, 0));
  return coalesce((select max(i.numero) from public.issue i where i.obra_id = p_obra), 0) + 1;
end;
$$;
revoke execute on function privado.proximo_numero_issue(uuid) from public, anon, authenticated;

-- Valida o caminho da imagem da vista: exatamente <obra>/<issue>/<vista>.png e confirmado no R2.
create function privado.validar_imagem_vista(p_obra uuid, p_issue uuid, p_vista uuid, p_path text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_esperado text := p_obra::text || '/' || p_issue::text || '/' || p_vista::text || '.png';
begin
  if p_path is distinct from v_esperado then
    raise exception 'Caminho da imagem inválido (esperado %)', v_esperado using errcode = '22023';
  end if;
  if not privado.arquivo_confirmado('issues', p_path) then
    raise exception 'Imagem não encontrada no armazenamento (issues/%): envie o arquivo antes de registrar', p_path
      using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function privado.validar_imagem_vista(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Listar ------------------------------------------------------------------------------------------

create function public.admin_listar_issues(p_obra uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if not exists (select 1 from public.obra o where o.id = p_obra) then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'numero', i.numero, 'guid', i.guid, 'titulo', i.titulo, 'descricao', i.descricao,
             'tipo', i.tipo, 'prioridade', i.prioridade, 'status', i.status,
             'responsavel_id', i.responsavel_id,
             'responsavel_nome', (select u.nome from public.usuario u where u.id = i.responsavel_id),
             'prazo', i.prazo,
             'criado_por', i.criado_por,
             'criado_por_nome', (select u.nome from public.usuario u where u.id = i.criado_por),
             'criado_em', i.criado_em, 'atualizado_em', i.atualizado_em,
             'vistas', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', v.id, 'guid', v.guid, 'vista', v.vista, 'imagem_path', v.imagem_path,
                        'criado_em', v.criado_em) order by v.criado_em, v.id)
                 from public.issue_vista v where v.issue_id = i.id
             ), '[]'::jsonb),
             'comentarios', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', c.id, 'guid', c.guid, 'autor_id', c.autor_id,
                        'autor_nome', (select u.nome from public.usuario u where u.id = c.autor_id),
                        'texto', c.texto, 'vista_id', c.vista_id, 'criado_em', c.criado_em)
                      order by c.criado_em, c.id)
                 from public.issue_comentario c where c.issue_id = i.id
             ), '[]'::jsonb)
           ) order by i.numero desc)
      from public.issue i
     where i.obra_id = p_obra
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_listar_issues(uuid) from public, anon;
grant execute on function public.admin_listar_issues(uuid) to authenticated;

-- Salvar (criar ou atualizar) ---------------------------------------------------------------------

-- Sem `id`: cria (exige obra_id e titulo). Com `id`: atualiza só as chaves presentes
-- (titulo, descricao, tipo, prioridade, status, responsavel_id, prazo). Retorno: {id, numero}.
create function public.admin_salvar_issue(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_obra uuid;
  v_issue public.issue;
  v_titulo text;
  v_descricao text;
  v_tipo text;
  v_prioridade text;
  v_status text;
  v_resp uuid;
  v_prazo date;
  v_numero int;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da issue inválidos' using errcode = '22023';
  end if;

  -- Validação das chaves presentes (vale para criar e atualizar).
  if p ? 'titulo' then
    if jsonb_typeof(p -> 'titulo') <> 'string' or char_length(btrim(p ->> 'titulo')) not between 1 and 200 then
      raise exception 'O título é obrigatório e tem até 200 caracteres' using errcode = '22023';
    end if;
    v_titulo := btrim(p ->> 'titulo');
  end if;
  if p ? 'descricao' and jsonb_typeof(p -> 'descricao') <> 'null' then
    if jsonb_typeof(p -> 'descricao') <> 'string' then
      raise exception 'A descrição precisa ser texto' using errcode = '22023';
    end if;
    v_descricao := p ->> 'descricao';
  end if;
  if p ? 'tipo' then
    v_tipo := p ->> 'tipo';
    if jsonb_typeof(p -> 'tipo') <> 'string' or v_tipo not in ('problema', 'duvida', 'conflito', 'pendencia') then
      raise exception 'Tipo inválido: use problema, duvida, conflito ou pendencia' using errcode = '22023';
    end if;
  end if;
  if p ? 'prioridade' then
    v_prioridade := p ->> 'prioridade';
    if jsonb_typeof(p -> 'prioridade') <> 'string' or v_prioridade not in ('baixa', 'normal', 'alta', 'critica') then
      raise exception 'Prioridade inválida: use baixa, normal, alta ou critica' using errcode = '22023';
    end if;
  end if;
  if p ? 'status' then
    v_status := p ->> 'status';
    if jsonb_typeof(p -> 'status') <> 'string' or v_status not in ('aberta', 'em_andamento', 'resolvida', 'fechada') then
      raise exception 'Status inválido: use aberta, em_andamento, resolvida ou fechada' using errcode = '22023';
    end if;
  end if;
  if p ? 'responsavel_id' and jsonb_typeof(p -> 'responsavel_id') <> 'null' then
    if jsonb_typeof(p -> 'responsavel_id') <> 'string' or not privado.uuid_texto_valido(p ->> 'responsavel_id') then
      raise exception 'Responsável inválido: esperado um UUID' using errcode = '22023';
    end if;
    v_resp := (p ->> 'responsavel_id')::uuid;
    if not exists (select 1 from public.admin_app a where a.usuario_id = v_resp) then
      raise exception 'O responsável precisa ser administrador do app' using errcode = '22023';
    end if;
  end if;
  if p ? 'prazo' and jsonb_typeof(p -> 'prazo') <> 'null' then
    if jsonb_typeof(p -> 'prazo') <> 'string' or (p ->> 'prazo') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Prazo inválido: use a data no formato AAAA-MM-DD' using errcode = '22023';
    end if;
    v_prazo := (p ->> 'prazo')::date;
  end if;

  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    if jsonb_typeof(p -> 'id') <> 'string' or not privado.uuid_texto_valido(p ->> 'id') then
      raise exception 'Identificador da issue inválido: esperado um UUID' using errcode = '22023';
    end if;
    v_id := (p ->> 'id')::uuid;
    select * into v_issue from public.issue i where i.id = v_id for update;
    if not found then
      raise exception 'Issue não encontrada' using errcode = 'P0002';
    end if;
    update public.issue i
       set titulo = case when p ? 'titulo' then v_titulo else i.titulo end,
           descricao = case when p ? 'descricao' then v_descricao else i.descricao end,
           tipo = case when p ? 'tipo' then v_tipo else i.tipo end,
           prioridade = case when p ? 'prioridade' then v_prioridade else i.prioridade end,
           status = case when p ? 'status' then v_status else i.status end,
           responsavel_id = case when p ? 'responsavel_id' then v_resp else i.responsavel_id end,
           prazo = case when p ? 'prazo' then v_prazo else i.prazo end,
           atualizado_em = now()
     where i.id = v_id;
    return jsonb_build_object('id', v_id, 'numero', v_issue.numero);
  end if;

  -- Criar
  if jsonb_typeof(p -> 'obra_id') is distinct from 'string' or not privado.uuid_texto_valido(p ->> 'obra_id') then
    raise exception 'Obra inválida: esperado um UUID em obra_id' using errcode = '22023';
  end if;
  v_obra := (p ->> 'obra_id')::uuid;
  if not exists (select 1 from public.obra o where o.id = v_obra) then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;
  if v_titulo is null then
    raise exception 'O título é obrigatório e tem até 200 caracteres' using errcode = '22023';
  end if;
  v_numero := privado.proximo_numero_issue(v_obra);
  insert into public.issue (obra_id, numero, titulo, descricao, tipo, prioridade, status, responsavel_id, prazo, criado_por)
  values (v_obra, v_numero, v_titulo, v_descricao, coalesce(v_tipo, 'problema'), coalesce(v_prioridade, 'normal'),
          coalesce(v_status, 'aberta'), v_resp, v_prazo, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;
revoke execute on function public.admin_salvar_issue(jsonb) from public, anon;
grant execute on function public.admin_salvar_issue(jsonb) to authenticated;

-- Comentar ----------------------------------------------------------------------------------------

create function public.admin_comentar_issue(p_issue uuid, p_texto text, p_vista uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_texto text := btrim(p_texto);
begin
  perform privado.exigir_admin();
  perform 1 from public.issue i where i.id = p_issue for update;
  if not found then
    raise exception 'Issue não encontrada' using errcode = 'P0002';
  end if;
  if v_texto is null or char_length(v_texto) not between 1 and 5000 then
    raise exception 'O comentário é obrigatório e tem até 5000 caracteres' using errcode = '22023';
  end if;
  if p_vista is not null
     and not exists (select 1 from public.issue_vista v where v.id = p_vista and v.issue_id = p_issue) then
    raise exception 'A vista não pertence a esta issue' using errcode = '22023';
  end if;
  insert into public.issue_comentario (issue_id, autor_id, texto, vista_id)
  values (p_issue, auth.uid(), v_texto, p_vista)
  returning id into v_id;
  update public.issue set atualizado_em = now() where id = p_issue;
  return v_id;
end;
$$;
revoke execute on function public.admin_comentar_issue(uuid, text, uuid) from public, anon;
grant execute on function public.admin_comentar_issue(uuid, text, uuid) to authenticated;

-- Salvar vista ------------------------------------------------------------------------------------

-- O cliente gera `p_id` antes de enviar a imagem (<obra_id>/<issue_id>/<p_id>.png). Idempotente por `p_id`.
create function public.admin_salvar_vista_issue(p_issue uuid, p_id uuid, p_vista jsonb, p_imagem_path text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.issue;
  v_existente public.issue_vista;
begin
  perform privado.exigir_admin();
  select * into v_issue from public.issue i where i.id = p_issue for update;
  if not found then
    raise exception 'Issue não encontrada' using errcode = 'P0002';
  end if;
  if p_id is null then
    raise exception 'Identificador da vista obrigatório' using errcode = '22023';
  end if;
  if p_vista is null or jsonb_typeof(p_vista) <> 'object' then
    raise exception 'Vista inválida: esperado um objeto' using errcode = '22023';
  end if;
  if p_imagem_path is not null then
    perform privado.validar_imagem_vista(v_issue.obra_id, p_issue, p_id, p_imagem_path);
  end if;

  select * into v_existente from public.issue_vista v where v.id = p_id;
  if found then
    if v_existente.issue_id <> p_issue then
      raise exception 'Esta vista pertence a outra issue' using errcode = '22023';
    end if;
    update public.issue_vista
       set vista = p_vista, imagem_path = coalesce(p_imagem_path, imagem_path)
     where id = p_id;
  else
    insert into public.issue_vista (id, issue_id, vista, imagem_path)
    values (p_id, p_issue, p_vista, p_imagem_path);
  end if;
  update public.issue set atualizado_em = now() where id = p_issue;
  return p_id;
end;
$$;
revoke execute on function public.admin_salvar_vista_issue(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.admin_salvar_vista_issue(uuid, uuid, jsonb, text) to authenticated;

-- Importar BCF ------------------------------------------------------------------------------------

-- p_topicos: [{guid, titulo, descricao, tipo, prioridade, status, prazo, criado_em?,
--              comentarios: [{guid, texto, criado_em?, vista_guid?}],
--              vistas: [{guid, id?, vista, imagem_path?, criado_em?}]}]
-- Upsert por guid; idempotente. Retorno: {criadas, atualizadas}.
create function public.admin_importar_bcf(p_obra uuid, p_topicos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t jsonb;
  v_c jsonb;
  v_v jsonb;
  v_guid uuid;
  v_issue public.issue;
  v_issue_id uuid;
  v_titulo text;
  v_descricao text;
  v_tipo text;
  v_prioridade text;
  v_status text;
  v_prazo date;
  v_criado timestamptz;
  v_cguid uuid;
  v_vguid uuid;
  v_vid uuid;
  v_vista_id uuid;
  v_texto text;
  v_path text;
  v_criadas int := 0;
  v_atualizadas int := 0;
begin
  perform privado.exigir_admin();
  if not exists (select 1 from public.obra o where o.id = p_obra) then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;
  if p_topicos is null or jsonb_typeof(p_topicos) <> 'array' then
    raise exception 'Tópicos inválidos: esperado uma lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_topicos) > 1000 then
    raise exception 'Tópicos demais: no máximo 1000 por importação' using errcode = '22023';
  end if;

  for v_t in select * from jsonb_array_elements(p_topicos) loop
    if jsonb_typeof(v_t) <> 'object' then
      raise exception 'Tópico inválido' using errcode = '22023';
    end if;
    if jsonb_typeof(v_t -> 'guid') is distinct from 'string' or not privado.uuid_texto_valido(v_t ->> 'guid') then
      raise exception 'GUID do tópico inválido: esperado um UUID' using errcode = '22023';
    end if;
    v_guid := (v_t ->> 'guid')::uuid;
    if jsonb_typeof(v_t -> 'titulo') is distinct from 'string'
       or char_length(btrim(v_t ->> 'titulo')) not between 1 and 200 then
      raise exception 'O título do tópico é obrigatório e tem até 200 caracteres' using errcode = '22023';
    end if;
    v_titulo := btrim(v_t ->> 'titulo');
    v_descricao := case when jsonb_typeof(v_t -> 'descricao') = 'string' then v_t ->> 'descricao' end;
    v_tipo := coalesce(v_t ->> 'tipo', 'problema');
    if v_tipo not in ('problema', 'duvida', 'conflito', 'pendencia') then
      raise exception 'Tipo inválido no tópico %: use problema, duvida, conflito ou pendencia', v_guid using errcode = '22023';
    end if;
    v_prioridade := coalesce(v_t ->> 'prioridade', 'normal');
    if v_prioridade not in ('baixa', 'normal', 'alta', 'critica') then
      raise exception 'Prioridade inválida no tópico %', v_guid using errcode = '22023';
    end if;
    v_status := coalesce(v_t ->> 'status', 'aberta');
    if v_status not in ('aberta', 'em_andamento', 'resolvida', 'fechada') then
      raise exception 'Status inválido no tópico %', v_guid using errcode = '22023';
    end if;
    v_prazo := null;
    if jsonb_typeof(v_t -> 'prazo') = 'string' then
      if (v_t ->> 'prazo') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Prazo inválido no tópico %: use AAAA-MM-DD', v_guid using errcode = '22023';
      end if;
      v_prazo := (v_t ->> 'prazo')::date;
    end if;
    v_criado := null;
    if jsonb_typeof(v_t -> 'criado_em') = 'string' then
      v_criado := (v_t ->> 'criado_em')::timestamptz;
    end if;

    select * into v_issue from public.issue i where i.guid = v_guid for update;
    if found then
      if v_issue.obra_id <> p_obra then
        raise exception 'O tópico % pertence a outra obra', v_guid using errcode = '22023';
      end if;
      update public.issue
         set titulo = v_titulo, descricao = v_descricao, tipo = v_tipo, prioridade = v_prioridade,
             status = v_status, prazo = v_prazo, atualizado_em = now()
       where id = v_issue.id;
      v_issue_id := v_issue.id;
      v_atualizadas := v_atualizadas + 1;
    else
      insert into public.issue (obra_id, numero, guid, titulo, descricao, tipo, prioridade, status, prazo,
                                criado_por, criado_em)
      values (p_obra, privado.proximo_numero_issue(p_obra), v_guid, v_titulo, v_descricao, v_tipo, v_prioridade,
              v_status, v_prazo, auth.uid(), coalesce(v_criado, now()))
      returning id into v_issue_id;
      v_criadas := v_criadas + 1;
    end if;

    -- Vistas primeiro (os comentários podem apontar para elas).
    if jsonb_typeof(v_t -> 'vistas') = 'array' then
      for v_v in select * from jsonb_array_elements(v_t -> 'vistas') loop
        if jsonb_typeof(v_v) <> 'object'
           or jsonb_typeof(v_v -> 'guid') is distinct from 'string'
           or not privado.uuid_texto_valido(v_v ->> 'guid')
           or jsonb_typeof(v_v -> 'vista') is distinct from 'object' then
          raise exception 'Vista inválida no tópico %: esperado guid (UUID) e vista (objeto)', v_guid using errcode = '22023';
        end if;
        v_vguid := (v_v ->> 'guid')::uuid;
        v_criado := null;
        if jsonb_typeof(v_v -> 'criado_em') = 'string' then
          v_criado := (v_v ->> 'criado_em')::timestamptz;
        end if;
        v_path := case when jsonb_typeof(v_v -> 'imagem_path') = 'string' then v_v ->> 'imagem_path' end;

        select v.id into v_vid from public.issue_vista v where v.guid = v_vguid and v.issue_id = v_issue_id;
        if not found then
          if exists (select 1 from public.issue_vista v where v.guid = v_vguid) then
            raise exception 'A vista % pertence a outra issue', v_vguid using errcode = '22023';
          end if;
          v_vid := gen_random_uuid();
          if jsonb_typeof(v_v -> 'id') = 'string' then
            if not privado.uuid_texto_valido(v_v ->> 'id') then
              raise exception 'Identificador da vista % inválido', v_vguid using errcode = '22023';
            end if;
            v_vid := (v_v ->> 'id')::uuid;
            if exists (select 1 from public.issue_vista v where v.id = v_vid) then
              raise exception 'O identificador da vista % já está em uso', v_vid using errcode = '22023';
            end if;
          end if;
          if v_path is not null then
            perform privado.validar_imagem_vista(p_obra, v_issue_id, v_vid, v_path);
          end if;
          insert into public.issue_vista (id, issue_id, guid, vista, imagem_path, criado_em)
          values (v_vid, v_issue_id, v_vguid, v_v -> 'vista', v_path, coalesce(v_criado, now()));
        else
          if v_path is not null then
            perform privado.validar_imagem_vista(p_obra, v_issue_id, v_vid, v_path);
          end if;
          update public.issue_vista
             set vista = v_v -> 'vista', imagem_path = coalesce(v_path, imagem_path)
           where id = v_vid;
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_t -> 'comentarios') = 'array' then
      for v_c in select * from jsonb_array_elements(v_t -> 'comentarios') loop
        if jsonb_typeof(v_c) <> 'object'
           or jsonb_typeof(v_c -> 'guid') is distinct from 'string'
           or not privado.uuid_texto_valido(v_c ->> 'guid') then
          raise exception 'Comentário inválido no tópico %: esperado guid (UUID)', v_guid using errcode = '22023';
        end if;
        v_cguid := (v_c ->> 'guid')::uuid;
        if jsonb_typeof(v_c -> 'texto') is distinct from 'string'
           or char_length(btrim(v_c ->> 'texto')) not between 1 and 5000 then
          raise exception 'O texto do comentário % é obrigatório e tem até 5000 caracteres', v_cguid using errcode = '22023';
        end if;
        v_texto := btrim(v_c ->> 'texto');
        v_criado := null;
        if jsonb_typeof(v_c -> 'criado_em') = 'string' then
          v_criado := (v_c ->> 'criado_em')::timestamptz;
        end if;
        v_vista_id := null;
        if jsonb_typeof(v_c -> 'vista_guid') = 'string' then
          if not privado.uuid_texto_valido(v_c ->> 'vista_guid') then
            raise exception 'vista_guid do comentário % inválido', v_cguid using errcode = '22023';
          end if;
          select v.id into v_vista_id from public.issue_vista v
           where v.issue_id = v_issue_id and v.guid = (v_c ->> 'vista_guid')::uuid;
          if v_vista_id is null then
            raise exception 'O comentário % aponta para uma vista inexistente neste tópico', v_cguid using errcode = '22023';
          end if;
        end if;

        if exists (select 1 from public.issue_comentario c where c.guid = v_cguid) then
          update public.issue_comentario
             set texto = v_texto, vista_id = v_vista_id
           where guid = v_cguid and issue_id = v_issue_id;
          if not found then
            raise exception 'O comentário % pertence a outra issue', v_cguid using errcode = '22023';
          end if;
        else
          insert into public.issue_comentario (issue_id, guid, autor_id, texto, vista_id, criado_em)
          values (v_issue_id, v_cguid, null, v_texto, v_vista_id, coalesce(v_criado, now()));
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'atualizadas', v_atualizadas);
end;
$$;
revoke execute on function public.admin_importar_bcf(uuid, jsonb) from public, anon;
grant execute on function public.admin_importar_bcf(uuid, jsonb) to authenticated;

-- Central de obras: passa a contar as issues abertas ----------------------------------------------

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
             -- issues abertas ou em andamento
             'issues_abertas', (select count(*) from public.issue i
                                 where i.obra_id = o.id and i.status in ('aberta', 'em_andamento')),
             'atualizado_em', greatest(
               (select max(pm.publicado_em) from public.publicacao_modelo pm where pm.obra_id = o.id),
               (select max(d.enviado_em) from public.documento d where d.obra_id = o.id),
               (select max(i.atualizado_em) from public.issue i where i.obra_id = o.id)
             )
           ) order by o.nome)
      from public.obra o
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_central_obras() from public, anon;
grant execute on function public.admin_central_obras() to authenticated;
