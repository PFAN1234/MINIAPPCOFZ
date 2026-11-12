-- Site de administração: arquivar e excluir obra. Documentação: docs/admin.md ("Arquivar e
-- excluir obra").
--
-- Arquivar (reversível, nada é apagado): a obra some do Mini App para quem não é admin,
-- deixa de aceitar registros, fotos, pedidos de acesso e vínculo com o Telegram, e as
-- publicações pendentes dela ficam paradas na fila até a obra ser desarquivada.
-- O bloqueio vem de `privado.eh_participante` e `privado.eh_gestor`, que passam a devolver
-- false para obra arquivada: as políticas de RLS (tabelas e Storage) e as RPCs do Mini App
-- já dependem delas. Os caminhos da service role (sincronizar_acesso, vincular_obra,
-- reivindicar_publicacoes) conferem a obra arquivada por conta própria.
--
-- Excluir (irreversível): apaga a obra e todas as linhas dela numa transação e grava a
-- auditoria em `obra_excluida`. Os arquivos do Storage (buckets fotos, plantas, originais e
-- modelos, todos em <obra_id>/...) não saem aqui: o Supabase proíbe delete direto nas tabelas
-- do Storage. Quem remove é a Edge Function `admin-excluir-obra`, pela API do Storage, e
-- registra o resultado com `admin_registrar_limpeza`.

-- Arquivar: colunas --------------------------------------------------------------------------

alter table public.obra
  add column arquivada_em timestamptz,
  add column arquivada_por uuid references public.usuario (id) on delete set null;

comment on column public.obra.arquivada_em is
  'Preenchida quando a obra é arquivada pelo site de administração: some do Mini App e para de publicar.';

-- Permissões: obra arquivada não tem participantes nem gestores ativos ------------------------
-- (create or replace mantém a assinatura, os atributos e os grants.)

create or replace function privado.eh_participante(p_obra uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.participacao p
      join public.obra o on o.id = p.obra_id
     where p.obra_id = p_obra and p.usuario_id = auth.uid() and o.arquivada_em is null
  );
$$;

create or replace function privado.eh_gestor(p_obra uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.participacao p
      join public.obra o on o.id = p.obra_id
     where p.obra_id = p_obra and p.usuario_id = auth.uid() and p.papel = 'gestor'
       and o.arquivada_em is null
  );
$$;

-- Nomes de outros usuários: só por obra em comum que não esteja arquivada.
create or replace function privado.divide_obra_com(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.participacao a
      join public.participacao b on b.obra_id = a.obra_id
      join public.obra o on o.id = a.obra_id
     where a.usuario_id = auth.uid() and b.usuario_id = p_usuario and o.arquivada_em is null
  );
$$;

-- Acesso e publicação (fase 6), agora cientes da obra arquivada ---------------------------------

create or replace function public.obras_disponiveis()
returns table (id uuid, slug text, nome text, solicitacao text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;

  return query
  select o.id, o.slug, o.nome,
         (select case when s.estado in ('pendente', 'recusada') then s.estado end
            from public.solicitacao_acesso s
           where s.obra_id = o.id and s.usuario_id = v_usuario
           order by s.criado_em desc, s.id desc
           limit 1) as solicitacao
    from public.obra o
    join privado.membro_grupo m on m.obra_id = o.id and m.usuario_id = v_usuario
   where m.conferido_em > now() - interval '7 days'
     and o.arquivada_em is null
     and not exists (
       select 1 from public.participacao p
        where p.obra_id = o.id and p.usuario_id = v_usuario
     )
   order by o.ordem, o.nome;
end;
$$;

create or replace function public.solicitar_acesso(p_obra uuid)
returns public.solicitacao_acesso
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_sol public.solicitacao_acesso;
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;

  if exists (select 1 from public.obra o where o.id = p_obra and o.arquivada_em is not null) then
    raise exception 'Esta obra foi arquivada e não recebe pedidos de acesso.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from privado.membro_grupo m
     where m.obra_id = p_obra and m.usuario_id = v_usuario
       and m.conferido_em > now() - interval '7 days'
  ) then
    raise exception 'Entre no grupo da obra no Telegram para pedir acesso.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.participacao p where p.obra_id = p_obra and p.usuario_id = v_usuario
  ) then
    raise exception 'Você já tem acesso a esta obra.' using errcode = '23505';
  end if;

  select * into v_sol from public.solicitacao_acesso s
   where s.obra_id = p_obra and s.usuario_id = v_usuario and s.estado = 'pendente';
  if found then
    return v_sol;
  end if;

  if exists (
    select 1 from public.solicitacao_acesso s
     where s.obra_id = p_obra and s.usuario_id = v_usuario and s.estado = 'recusada'
       and s.decidido_em > now() - interval '24 hours'
  ) then
    raise exception 'Pedido recusado recentemente. Fale com o gestor da obra.' using errcode = '22023';
  end if;

  insert into public.solicitacao_acesso (obra_id, usuario_id, estado)
  values (p_obra, v_usuario, 'pendente')
  on conflict (obra_id, usuario_id) where estado = 'pendente' do nothing
  returning * into v_sol;
  if not found then
    -- Pedido simultâneo do mesmo usuário: devolve o que já existe.
    select * into v_sol from public.solicitacao_acesso s
     where s.obra_id = p_obra and s.usuario_id = v_usuario and s.estado = 'pendente';
  end if;
  return v_sol;
end;
$$;

create or replace function public.sincronizar_acesso(p_usuario uuid, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_obra uuid;
  v_situacao text;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'A lista de obras é inválida' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'obra_id') <> 'string'
       or (v_item ->> 'obra_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_item ->> 'situacao') is null
       or (v_item ->> 'situacao') not in ('admin', 'membro', 'fora') then
      raise exception 'Item de acesso inválido' using errcode = '22023';
    end if;
    v_obra := (v_item ->> 'obra_id')::uuid;
    v_situacao := v_item ->> 'situacao';

    -- Obra inexistente ou arquivada não derruba a sincronização das demais e não muda nada
    -- (ao desarquivar, o próximo login de cada pessoa volta a sincronizar).
    if not exists (select 1 from public.obra o where o.id = v_obra and o.arquivada_em is null) then
      continue;
    end if;

    if v_situacao in ('admin', 'membro') then
      insert into privado.membro_grupo (obra_id, usuario_id, conferido_em)
      values (v_obra, p_usuario, now())
      on conflict (obra_id, usuario_id) do update set conferido_em = excluded.conferido_em;
    end if;

    if v_situacao = 'admin' then
      insert into public.participacao (obra_id, usuario_id, papel)
      values (v_obra, p_usuario, 'gestor')
      on conflict (obra_id, usuario_id) do update set papel = 'gestor';
    elsif v_situacao = 'fora' then
      delete from public.participacao p where p.obra_id = v_obra and p.usuario_id = p_usuario;
      delete from privado.membro_grupo m where m.obra_id = v_obra and m.usuario_id = p_usuario;
      update public.solicitacao_acesso s
         set estado = 'recusada', decidido_por = null, decidido_em = now()
       where s.obra_id = v_obra and s.usuario_id = p_usuario and s.estado = 'pendente';
    end if;
  end loop;
end;
$$;

-- Obra arquivada: 22023 com a mensagem que o bot mostra no tópico.
create or replace function public.vincular_obra(p_slug text, p_chat bigint, p_thread bigint)
returns public.obra
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  select * into v_obra from public.obra o where o.slug = p_slug for update;
  if not found then
    return null;
  end if;
  if v_obra.arquivada_em is not null then
    raise exception 'A obra “%” está arquivada. Peça a um admin do Mini App para desarquivá-la antes de vincular o tópico.',
      v_obra.nome using errcode = '22023';
  end if;

  update public.obra o
     set telegram_chat_id = p_chat, telegram_thread_id = p_thread
   where o.id = v_obra.id
  returning * into v_obra;

  update public.publicacao_telegram p
     set proxima_tentativa_em = now(), atualizado_em = now()
   where p.obra_id = v_obra.id and p.estado = 'pendente';
  return v_obra;
end;
$$;

-- Itens de obra arquivada ficam "pendente" e não são reivindicados; voltam à fila quando a
-- obra é desarquivada.
create or replace function public.reivindicar_publicacoes(p_limite int default 10)
returns setof public.publicacao_telegram
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Envio interrompido há mais de 10 minutos: não dá para saber se saiu; vira "incerto".
  update public.publicacao_telegram p
     set estado = 'incerto', erro = 'Envio interrompido; conferir no tópico.', atualizado_em = now()
   where p.estado = 'enviando' and p.atualizado_em < now() - interval '10 minutes';

  return query
  update public.publicacao_telegram p
     set estado = 'enviando', tentativas = p.tentativas + 1, atualizado_em = now()
   where p.id in (
     select q.id from public.publicacao_telegram q
      where q.estado = 'pendente' and q.proxima_tentativa_em <= now()
        and not exists (
          select 1 from public.obra o where o.id = q.obra_id and o.arquivada_em is not null
        )
      order by q.id
      limit greatest(coalesce(p_limite, 10), 0)
      for update of q skip locked
   )
  returning p.*;
end;
$$;

-- Arquivar: RPC e listagens do site -------------------------------------------------------------

-- Arquiva (p_arquivada = true) ou desarquiva (false). Idempotente: arquivar de novo mantém a
-- data e o autor originais. Retorno: {slug, arquivada_em} (null ao desarquivar).
create function public.admin_arquivar_obra(p_slug text, p_arquivada boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  if p_arquivada is null then
    raise exception 'Informe se a obra deve ser arquivada ou desarquivada' using errcode = '22023';
  end if;
  v_obra := privado.obra_do_slug(p_slug);
  select * into v_obra from public.obra o where o.id = v_obra.id for update;

  if p_arquivada and v_obra.arquivada_em is null then
    update public.obra o set arquivada_em = now(), arquivada_por = auth.uid()
     where o.id = v_obra.id
    returning * into v_obra;
  elsif not p_arquivada and v_obra.arquivada_em is not null then
    update public.obra o set arquivada_em = null, arquivada_por = null
     where o.id = v_obra.id
    returning * into v_obra;
    -- As publicações que ficaram paradas voltam à fila já (o cron publica no próximo minuto).
    update public.publicacao_telegram p
       set proxima_tentativa_em = now(), atualizado_em = now()
     where p.obra_id = v_obra.id and p.estado = 'pendente';
  end if;

  return jsonb_build_object('slug', v_obra.slug, 'arquivada_em', v_obra.arquivada_em);
end;
$$;

-- admin_listar_obras ganha `arquivada_em` (mudar as colunas de retorno exige drop + create).
drop function public.admin_listar_obras();

create function public.admin_listar_obras()
returns table (
  id uuid,
  slug text,
  nome text,
  ordem int,
  pavimentos jsonb,
  ambientes_ativos int,
  status text,
  config_atualizada_em timestamptz,
  arquivada_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
  select o.id, o.slug, o.nome, o.ordem,
         coalesce((
           select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nome', p.nome, 'ordem', p.ordem)
                            order by p.ordem, p.codigo)
             from public.pavimento p where p.obra_id = o.id
         ), '[]'::jsonb),
         (select count(*)::int from public.ambiente a where a.obra_id = o.id and a.ativo),
         c.config ->> 'status',
         c.atualizado_em,
         o.arquivada_em
    from public.obra o
    left join public.obra_config c on c.obra_id = o.id
   order by o.ordem, o.nome;
end;
$$;

revoke execute on function public.admin_listar_obras() from public, anon;
grant execute on function public.admin_listar_obras() to authenticated;

create or replace function public.admin_obter_obra(p_slug text)
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
    'obra', jsonb_build_object(
      'id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome, 'ordem', v_obra.ordem,
      'telegram_vinculado', v_obra.telegram_chat_id is not null,
      'arquivada_em', v_obra.arquivada_em
    ),
    'pavimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'codigo', p.codigo, 'nome', p.nome, 'ordem', p.ordem,
               'ambientes', (select count(*) from public.ambiente a where a.pavimento_id = p.id),
               'ambientes_ativos', (select count(*) from public.ambiente a where a.pavimento_id = p.id and a.ativo),
               'plantas', (select count(*) from public.planta pl where pl.pavimento_id = p.id)
             ) order by p.ordem, p.codigo)
        from public.pavimento p where p.obra_id = v_obra.id
    ), '[]'::jsonb),
    'config', (select c.config from public.obra_config c where c.obra_id = v_obra.id),
    'config_atualizada_em', (select c.atualizado_em from public.obra_config c where c.obra_id = v_obra.id),
    'config_atualizada_por', (
      select u.nome from public.obra_config c join public.usuario u on u.id = c.atualizado_por
       where c.obra_id = v_obra.id
    )
  );
end;
$$;

-- Excluir: auditoria ------------------------------------------------------------------------------

create table public.obra_excluida (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null,  -- sem FK: a obra não existe mais
  slug text not null,
  nome text not null,
  excluida_por uuid references public.usuario (id) on delete set null,
  excluida_em timestamptz not null default now(),
  -- contagens do que foi apagado (formato de admin_resumo_obra)
  resumo jsonb not null,
  -- limpeza dos arquivos no Storage, feita depois pela Edge Function admin-excluir-obra
  arquivos_removidos_em timestamptz,
  arquivos_removidos jsonb,
  arquivos_erro text,
  constraint obra_excluida_resumo_objeto check (jsonb_typeof(resumo) = 'object'),
  constraint obra_excluida_removidos_objeto check (
    arquivos_removidos is null or jsonb_typeof(arquivos_removidos) = 'object'
  )
);
create index obra_excluida_excluida_em_idx on public.obra_excluida (excluida_em desc);
alter table public.obra_excluida enable row level security;
revoke all on public.obra_excluida from public, anon, authenticated;

comment on table public.obra_excluida is
  'Obras excluídas pelo site de administração (auditoria e limpeza do Storage); leitura só por admin, via RPC.';

-- Excluir: resumo ---------------------------------------------------------------------------------

-- Contagens do que a exclusão apaga, inclusive os objetos de cada bucket em <obra_id>/.
create function privado.resumo_obra(p_obra uuid)
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
               select count(*) from storage.objects o
                where o.bucket_id = b.bucket and o.name like p_obra::text || '/%'
             ))
        from unnest(array['fotos', 'plantas', 'originais', 'modelos']) as b(bucket)
    )
  );
$$;
revoke execute on function privado.resumo_obra(uuid) from public, anon, authenticated;

create function public.admin_resumo_obra(p_slug text)
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
  return privado.resumo_obra(v_obra.id);
end;
$$;

-- Excluir -----------------------------------------------------------------------------------------

-- A confirmação é o nome da obra, exatamente (só espaços nas pontas são ignorados).
-- Retorno: {exclusao_id, obra_id, resumo}. Os arquivos do Storage ficam para a Edge Function.
create function public.admin_excluir_obra(p_slug text, p_confirmacao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_resumo jsonb;
  v_id uuid;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  -- Trava a obra: espera publicações e edições em andamento e barra novos registros (a FK
  -- de registro e das outras tabelas precisa de trava compatível na linha da obra).
  select * into v_obra from public.obra o where o.id = v_obra.id for update;
  if not found then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;

  if p_confirmacao is null or btrim(p_confirmacao) <> btrim(v_obra.nome) then
    raise exception 'Para excluir, digite exatamente o nome da obra: %', v_obra.nome using errcode = '22023';
  end if;

  v_resumo := privado.resumo_obra(v_obra.id);

  insert into public.obra_excluida (obra_id, slug, nome, excluida_por, resumo)
  values (v_obra.id, v_obra.slug, v_obra.nome, auth.uid(), v_resumo)
  returning id into v_id;

  -- registro → ambiente e planta_detalhe → ambiente não têm cascata (o ambiente não pode
  -- ser apagado enquanto tiver histórico). Apaga esses filhos antes, na ordem; o resto sai
  -- pela cascata de obra: registro leva encerramento, foto e publicacao_telegram.
  delete from public.registro r where r.obra_id = v_obra.id;
  delete from public.planta_detalhe d where d.obra_id = v_obra.id;
  delete from public.obra o where o.id = v_obra.id;

  return jsonb_build_object('exclusao_id', v_id, 'obra_id', v_obra.id, 'resumo', v_resumo);
end;
$$;

-- Últimas 50 exclusões, da mais recente.
create function public.admin_listar_exclusoes()
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
             'id', x.id, 'obra_id', x.obra_id, 'slug', x.slug, 'nome', x.nome,
             'excluida_em', x.excluida_em, 'excluida_por_nome', x.excluida_por_nome, 'resumo', x.resumo,
             'arquivos_removidos_em', x.arquivos_removidos_em, 'arquivos_removidos', x.arquivos_removidos,
             'arquivos_erro', x.arquivos_erro
           ) order by x.excluida_em desc, x.id)
      from (
        select e.*, u.nome as excluida_por_nome
          from public.obra_excluida e
          left join public.usuario u on u.id = e.excluida_por
         order by e.excluida_em desc, e.id
         limit 50
      ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_arquivar_obra(text, boolean) from public, anon;
revoke execute on function public.admin_resumo_obra(text) from public, anon;
revoke execute on function public.admin_excluir_obra(text, text) from public, anon;
revoke execute on function public.admin_listar_exclusoes() from public, anon;
grant execute on function public.admin_arquivar_obra(text, boolean) to authenticated;
grant execute on function public.admin_resumo_obra(text) to authenticated;
grant execute on function public.admin_excluir_obra(text, text) to authenticated;
grant execute on function public.admin_listar_exclusoes() to authenticated;

-- Limpeza do Storage: só service_role (Edge Function admin-excluir-obra) -------------------------

-- obra_id da exclusão (o prefixo <obra_id>/ dos arquivos a remover). P0002 se não existir.
create function public.admin_exclusao_para_limpar(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obra uuid;
begin
  select e.obra_id into v_obra from public.obra_excluida e where e.id = p_id;
  if v_obra is null then
    raise exception 'Exclusão não encontrada' using errcode = 'P0002';
  end if;
  return v_obra;
end;
$$;

-- Resultado da limpeza. p_removidos: {"fotos": n, "plantas": n, "originais": n, "modelos": n}
-- removidos NESTA tentativa; somados aos de tentativas anteriores. Sem erro: marca a limpeza
-- como concluída e apaga o erro anterior. Com erro: guarda o erro (até 500 caracteres).
create function public.admin_registrar_limpeza(p_id uuid, p_removidos jsonb, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exc public.obra_excluida;
  v_total jsonb;
begin
  if p_removidos is not null and (
       jsonb_typeof(p_removidos) <> 'object'
       or exists (select 1 from jsonb_each(p_removidos) e
                   where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}') !~ '^\d{1,12}$')
     ) then
    raise exception 'Contagem de arquivos removidos inválida' using errcode = '22023';
  end if;

  select * into v_exc from public.obra_excluida e where e.id = p_id for update;
  if not found then
    raise exception 'Exclusão não encontrada' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(k, (
           coalesce((v_exc.arquivos_removidos ->> k)::bigint, 0)
           + coalesce((p_removidos ->> k)::bigint, 0)
         )), '{}'::jsonb)
    into v_total
    from (
      select jsonb_object_keys(coalesce(v_exc.arquivos_removidos, '{}'::jsonb))
      union
      select jsonb_object_keys(coalesce(p_removidos, '{}'::jsonb))
    ) as t(k);

  if p_erro is null then
    update public.obra_excluida e
       set arquivos_removidos_em = now(), arquivos_removidos = v_total, arquivos_erro = null
     where e.id = p_id;
  else
    update public.obra_excluida e
       set arquivos_removidos = v_total, arquivos_erro = left(p_erro, 500)
     where e.id = p_id;
  end if;
end;
$$;

revoke execute on function public.admin_exclusao_para_limpar(uuid) from public, anon, authenticated;
revoke execute on function public.admin_registrar_limpeza(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_exclusao_para_limpar(uuid) to service_role;
grant execute on function public.admin_registrar_limpeza(uuid, jsonb, text) to service_role;
