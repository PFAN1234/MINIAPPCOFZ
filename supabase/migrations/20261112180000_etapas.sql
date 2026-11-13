-- Etapas e organização militar. Contrato: docs/contrato-etapas.md; documentação: docs/admin.md
-- ("Etapas e organização").
--
-- - `etapa`: o campus é implantado em etapas; cada etapa agrupa obras e tem um grupo do
--   Telegram (um tópico por obra). Todas as obras existentes entram na "2ª ETAPA" (`2a-etapa`).
-- - Obra "ativa" passa a ser: obra não arquivada E etapa não arquivada. Arquivar a etapa vale
--   como arquivar todas as obras dela, sem mexer no `arquivada_em` de cada obra (desarquivar a
--   etapa devolve cada obra ao estado que tinha).
-- - `organizacao`: nome e logo da organização militar (linha única), lidos pela RPC
--   `organizacao()` (também para anon) e gravados por `admin_salvar_organizacao`. O logo fica
--   no bucket público `organizacao`.
-- - Excluir etapa apaga a etapa e todas as obras dela, com uma linha em `obra_excluida` por obra
--   (com `etapa_nome`); os arquivos saem pela Edge Function admin-excluir-obra.

-- Tabelas ------------------------------------------------------------------------------------------

create table public.etapa (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  nome text not null,
  ordem int not null default 0,
  telegram_chat_id bigint,
  telegram_chat_titulo text,
  arquivada_em timestamptz,
  arquivada_por uuid references public.usuario (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint etapa_slug_unico unique (slug),
  constraint etapa_slug_formato check (slug ~ '^[a-z0-9-]+$' and char_length(slug) <= 40),
  constraint etapa_nome_tamanho check (char_length(nome) between 1 and 120),
  constraint etapa_telegram_chat_unico unique (telegram_chat_id)
);

comment on table public.etapa is
  'Etapas da implantação do campus: agrupam obras e têm um grupo do Telegram (um tópico por obra).';
comment on column public.etapa.telegram_chat_id is
  'Grupo do Telegram da etapa (/vincular_etapa); null = sem grupo.';
comment on column public.etapa.arquivada_em is
  'Etapa arquivada: vale como arquivar todas as obras dela, sem mexer no arquivada_em de cada uma.';

create table public.organizacao (
  id boolean primary key default true,
  nome text not null default 'CO-FZ',
  logo_path text,
  atualizado_em timestamptz,
  atualizado_por uuid references public.usuario (id) on delete set null,
  constraint organizacao_linha_unica check (id),
  constraint organizacao_nome_tamanho check (char_length(nome) between 1 and 80),
  constraint organizacao_logo_formato check (
    logo_path is null or logo_path ~ '^logo-[0-9a-f]{16}\.(png|jpg|webp)$'
  )
);
alter table public.organizacao enable row level security;
revoke all on public.organizacao from public, anon, authenticated;
insert into public.organizacao (id) values (true);

comment on table public.organizacao is
  'Identidade da organização militar (linha única): nome e logo (bucket público organizacao). Leitura pela RPC organizacao().';

alter table public.obra_excluida add column etapa_nome text;
comment on column public.obra_excluida.etapa_nome is
  'Nome da etapa quando a obra foi excluída junto com ela (admin_excluir_etapa).';

-- Migração dos dados: todas as obras na "2ª ETAPA" ---------------------------------------------

-- Se as obras já vinculadas apontam todas para o mesmo grupo, a etapa herda esse grupo.
insert into public.etapa (slug, nome, telegram_chat_id)
select '2a-etapa', '2ª ETAPA',
       (select case when count(distinct o.telegram_chat_id) = 1 then min(o.telegram_chat_id) end
          from public.obra o where o.telegram_chat_id is not null);

alter table public.obra add column etapa_id uuid;
update public.obra o set etapa_id = (select e.id from public.etapa e where e.slug = '2a-etapa');
alter table public.obra
  alter column etapa_id set not null,
  add constraint obra_etapa_fk foreign key (etapa_id) references public.etapa (id) on delete restrict;
create index obra_etapa_id_idx on public.obra (etapa_id);

-- RLS da etapa: leitura para quem participa de obra ativa da etapa e para admin --------------------

create function privado.participa_da_etapa(p_etapa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.obra o
      join public.etapa e on e.id = o.etapa_id
      join public.participacao p on p.obra_id = o.id
     where o.etapa_id = p_etapa and p.usuario_id = auth.uid()
       and o.arquivada_em is null and e.arquivada_em is null
  );
$$;
revoke execute on function privado.participa_da_etapa(uuid) from public, anon;
grant execute on function privado.participa_da_etapa(uuid) to authenticated;

alter table public.etapa enable row level security;
revoke all on public.etapa from public, anon, authenticated;
grant select on public.etapa to authenticated;

create policy etapa_select on public.etapa
  for select to authenticated using (privado.eh_admin() or privado.participa_da_etapa(id));

-- Obra ativa = obra não arquivada e etapa não arquivada --------------------------------------------

create function privado.obra_ativa(p_obra uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.obra o join public.etapa e on e.id = o.etapa_id
     where o.id = p_obra and o.arquivada_em is null and e.arquivada_em is null
  );
$$;
revoke execute on function privado.obra_ativa(uuid) from public, anon, authenticated;

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
      join public.etapa e on e.id = o.etapa_id
     where p.obra_id = p_obra and p.usuario_id = auth.uid()
       and o.arquivada_em is null and e.arquivada_em is null
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
      join public.etapa e on e.id = o.etapa_id
     where p.obra_id = p_obra and p.usuario_id = auth.uid() and p.papel = 'gestor'
       and o.arquivada_em is null and e.arquivada_em is null
  );
$$;

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
      join public.etapa e on e.id = o.etapa_id
     where a.usuario_id = auth.uid() and b.usuario_id = p_usuario
       and o.arquivada_em is null and e.arquivada_em is null
  );
$$;

-- obras_disponiveis ganha a etapa (mudar as colunas de retorno exige drop + create).
drop function public.obras_disponiveis();

create function public.obras_disponiveis()
returns table (
  id uuid,
  slug text,
  nome text,
  solicitacao text,
  etapa_id uuid,
  etapa_nome text,
  etapa_ordem int
)
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
           limit 1) as solicitacao,
         e.id, e.nome, e.ordem
    from public.obra o
    join public.etapa e on e.id = o.etapa_id
    join privado.membro_grupo m on m.obra_id = o.id and m.usuario_id = v_usuario
   where m.conferido_em > now() - interval '7 days'
     and o.arquivada_em is null
     and e.arquivada_em is null
     and not exists (
       select 1 from public.participacao p
        where p.obra_id = o.id and p.usuario_id = v_usuario
     )
   order by e.ordem, e.nome, o.ordem, o.nome;
end;
$$;

revoke execute on function public.obras_disponiveis() from public, anon;
grant execute on function public.obras_disponiveis() to authenticated;

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

  if exists (select 1 from public.obra o where o.id = p_obra) and not privado.obra_ativa(p_obra) then
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

    -- Obra inexistente ou arquivada (ela ou a etapa) não derruba a sincronização das demais e
    -- não muda nada (ao desarquivar, o próximo login de cada pessoa volta a sincronizar).
    if not privado.obra_ativa(v_obra) then
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

-- Itens de obra arquivada (ela ou a etapa) ficam "pendente" e não são reivindicados.
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
          select 1 from public.obra o join public.etapa e on e.id = o.etapa_id
           where o.id = q.obra_id and (o.arquivada_em is not null or e.arquivada_em is not null)
        )
      order by q.id
      limit greatest(coalesce(p_limite, 10), 0)
      for update of q skip locked
   )
  returning p.*;
end;
$$;

-- Bot: vínculo do grupo da etapa e do tópico da obra (service_role) --------------------------------

-- Grupo da etapa (/vincular_etapa <slug>). null se o slug não existe. 22023, com a mensagem que o
-- bot repete no grupo: etapa arquivada, grupo de outra etapa, etapa com outro grupo. O mesmo
-- grupo de novo só atualiza o título.
create function public.vincular_etapa(p_slug text, p_chat bigint, p_titulo text)
returns public.etapa
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
  v_outra public.etapa;
begin
  if p_chat is null then
    raise exception 'Grupo do Telegram inválido' using errcode = '22023';
  end if;
  select * into v_etapa from public.etapa e where e.slug = p_slug for update;
  if not found then
    return null;
  end if;
  if v_etapa.arquivada_em is not null then
    raise exception 'A etapa “%” está arquivada. Peça a um admin do Mini App para desarquivá-la antes de vincular o grupo.',
      v_etapa.nome using errcode = '22023';
  end if;
  select * into v_outra from public.etapa e where e.telegram_chat_id = p_chat and e.id <> v_etapa.id;
  if found then
    raise exception 'Este grupo já é da etapa “%”. Cada etapa usa um grupo próprio.', v_outra.nome
      using errcode = '22023';
  end if;
  if v_etapa.telegram_chat_id is not null and v_etapa.telegram_chat_id <> p_chat then
    raise exception 'A etapa “%” já está vinculada a outro grupo. Desvincule o grupo no site de administração antes de vincular este.',
      v_etapa.nome using errcode = '22023';
  end if;

  begin
    update public.etapa e
       set telegram_chat_id = p_chat, telegram_chat_titulo = nullif(btrim(left(p_titulo, 255)), '')
     where e.id = v_etapa.id
    returning * into v_etapa;
  exception when unique_violation then
    -- Outra etapa ficou com este grupo ao mesmo tempo.
    raise exception 'Este grupo já é de outra etapa. Cada etapa usa um grupo próprio.' using errcode = '22023';
  end;
  return v_etapa;
end;
$$;

-- Tópico da obra (/vincular_obra <slug>): obra e etapa ativas e o grupo tem de ser o da etapa.
create or replace function public.vincular_obra(p_slug text, p_chat bigint, p_thread bigint)
returns public.obra
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_etapa public.etapa;
begin
  select * into v_obra from public.obra o where o.slug = p_slug for update;
  if not found then
    return null;
  end if;
  if v_obra.arquivada_em is not null then
    raise exception 'A obra “%” está arquivada. Peça a um admin do Mini App para desarquivá-la antes de vincular o tópico.',
      v_obra.nome using errcode = '22023';
  end if;
  select * into v_etapa from public.etapa e where e.id = v_obra.etapa_id;
  if v_etapa.arquivada_em is not null then
    raise exception 'A obra “%” é da etapa “%”, que está arquivada. Peça a um admin do Mini App para desarquivá-la antes de vincular o tópico.',
      v_obra.nome, v_etapa.nome using errcode = '22023';
  end if;
  if v_etapa.telegram_chat_id is null then
    raise exception 'Vincule antes a etapa: /vincular_etapa %', v_etapa.slug using errcode = '22023';
  end if;
  if v_etapa.telegram_chat_id <> p_chat then
    raise exception 'A obra % é da etapa %, que usa outro grupo.', v_obra.nome, v_etapa.nome
      using errcode = '22023';
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

revoke execute on function public.vincular_etapa(text, bigint, text) from public, anon, authenticated;
grant execute on function public.vincular_etapa(text, bigint, text) to service_role;

-- Organização: leitura (Mini App e tela de entrada do site) ----------------------------------------

create function public.organizacao()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('nome', o.nome, 'logo_path', o.logo_path) from public.organizacao o where o.id),
    jsonb_build_object('nome', 'CO-FZ', 'logo_path', null)
  );
$$;
revoke execute on function public.organizacao() from public;
grant execute on function public.organizacao() to anon, authenticated;

-- Bucket público `organizacao`: logo-<16 hex>.<png|jpg|webp> --------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organizacao', 'organizacao', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Bucket público: a leitura do arquivo é pela URL pública; o admin também lê pela API (o
-- upsert do Storage exige select, insert e update).
create policy organizacao_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'organizacao' and privado.eh_admin());

create policy organizacao_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organizacao' and privado.eh_admin()
    and name ~ '^logo-[0-9a-f]{16}\.(png|jpg|webp)$'
  );

create policy organizacao_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'organizacao' and privado.eh_admin())
  with check (
    bucket_id = 'organizacao' and privado.eh_admin()
    and name ~ '^logo-[0-9a-f]{16}\.(png|jpg|webp)$'
  );

create policy organizacao_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'organizacao' and privado.eh_admin());

-- Site de administração: funções auxiliares -------------------------------------------------------

-- Etapa pelo slug (P0002 se não existir).
create function privado.etapa_do_slug(p_slug text)
returns public.etapa
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  select * into v_etapa from public.etapa e where e.slug = p_slug;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  return v_etapa;
end;
$$;
revoke execute on function privado.etapa_do_slug(text) from public, anon, authenticated;

-- Contagens do que a exclusão das obras da etapa apaga (formato de admin_resumo_obra, somado).
create function privado.resumo_etapa(p_etapa uuid)
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
               select count(*) from storage.objects so
                where so.bucket_id = b.bucket
                  and exists (select 1 from obras where so.name like obras.id::text || '/%')
             ))
        from unnest(array['fotos', 'plantas', 'originais', 'modelos']) as b(bucket)
    )
  );
$$;
revoke execute on function privado.resumo_etapa(uuid) from public, anon, authenticated;

-- Exclusão de uma obra, já travada pelo chamador: grava `obra_excluida` (com o nome da etapa
-- quando a obra sai junto com ela) e apaga as linhas. Devolve o id da exclusão. Usada por
-- admin_excluir_obra e admin_excluir_etapa.
create function privado.excluir_obra(p_obra uuid, p_etapa_nome text)
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
  delete from public.registro r where r.obra_id = v_obra.id;
  delete from public.planta_detalhe d where d.obra_id = v_obra.id;
  delete from public.obra o where o.id = v_obra.id;
  return v_id;
end;
$$;
revoke execute on function privado.excluir_obra(uuid, text) from public, anon, authenticated;

-- Excluir obra: mesma assinatura e retorno, agora pela função comum.
create or replace function public.admin_excluir_obra(p_slug text, p_confirmacao text)
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
  v_id := privado.excluir_obra(v_obra.id, null);
  return jsonb_build_object('exclusao_id', v_id, 'obra_id', v_obra.id, 'resumo', v_resumo);
end;
$$;

-- Site de administração: etapas -------------------------------------------------------------------

-- Por ordem e nome. `obras` conta todas as obras da etapa; `obras_arquivadas`, as arquivadas.
create function public.admin_listar_etapas()
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
             'id', e.id, 'slug', e.slug, 'nome', e.nome, 'ordem', e.ordem,
             'arquivada_em', e.arquivada_em,
             'telegram_vinculado', e.telegram_chat_id is not null,
             'telegram_chat_titulo', e.telegram_chat_titulo,
             'obras', (select count(*) from public.obra o where o.etapa_id = e.id),
             'obras_arquivadas', (
               select count(*) from public.obra o where o.etapa_id = e.id and o.arquivada_em is not null
             )
           ) order by e.ordem, e.nome, e.id)
      from public.etapa e
  ), '[]'::jsonb);
end;
$$;

-- Cria (sem `id`; slug obrigatório e único) ou edita (com `id`: nome e ordem) uma etapa.
create function public.admin_salvar_etapa(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text;
  v_nome text;
  v_ordem int;
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da etapa inválidos' using errcode = '22023';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    v_id := privado.uuid_ou_nulo(p ->> 'id');
    if v_id is null then
      raise exception 'Identificador da etapa inválido' using errcode = '22023';
    end if;
  end if;
  if p ? 'slug' and jsonb_typeof(p -> 'slug') not in ('string', 'null') then
    raise exception 'O slug precisa ser texto' using errcode = '22023';
  end if;
  if p ? 'nome' and jsonb_typeof(p -> 'nome') not in ('string', 'null') then
    raise exception 'O nome precisa ser texto' using errcode = '22023';
  end if;
  v_slug := p ->> 'slug';
  v_nome := btrim(p ->> 'nome');
  v_ordem := privado.inteiro_jsonb(p -> 'ordem', 'ordem');

  if v_nome is not null and (v_nome = '' or char_length(v_nome) > 120) then
    raise exception 'Informe o nome da etapa (até 120 caracteres)' using errcode = '22023';
  end if;

  if v_id is null then
    if v_slug is null or v_slug !~ '^[a-z0-9-]+$' or char_length(v_slug) > 40 then
      raise exception 'Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)'
        using errcode = '22023';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome da etapa (até 120 caracteres)' using errcode = '22023';
    end if;
    if exists (select 1 from public.etapa e where e.slug = v_slug) then
      raise exception 'Já existe uma etapa com o slug %', v_slug using errcode = '23505';
    end if;
    insert into public.etapa (slug, nome, ordem)
    values (v_slug, v_nome, coalesce(v_ordem, 0))
    returning * into v_etapa;
  else
    select * into v_etapa from public.etapa e where e.id = v_id for update;
    if not found then
      raise exception 'Etapa não encontrada' using errcode = 'P0002';
    end if;
    if v_slug is not null and v_slug <> v_etapa.slug then
      raise exception 'O slug não pode ser alterado depois de criado' using errcode = '22023';
    end if;
    update public.etapa e
       set nome = coalesce(v_nome, e.nome), ordem = coalesce(v_ordem, e.ordem)
     where e.id = v_id
    returning * into v_etapa;
  end if;

  return jsonb_build_object('id', v_etapa.id, 'slug', v_etapa.slug, 'nome', v_etapa.nome, 'ordem', v_etapa.ordem);
end;
$$;

-- Arquiva (true) ou desarquiva (false). Idempotente: arquivar de novo mantém a data e o autor.
-- Não mexe no arquivada_em das obras. Retorno: {slug, arquivada_em} (null ao desarquivar).
create function public.admin_arquivar_etapa(p_slug text, p_arquivada boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  if p_arquivada is null then
    raise exception 'Informe se a etapa deve ser arquivada ou desarquivada' using errcode = '22023';
  end if;
  v_etapa := privado.etapa_do_slug(p_slug);
  select * into v_etapa from public.etapa e where e.id = v_etapa.id for update;

  if p_arquivada and v_etapa.arquivada_em is null then
    update public.etapa e set arquivada_em = now(), arquivada_por = auth.uid()
     where e.id = v_etapa.id
    returning * into v_etapa;
  elsif not p_arquivada and v_etapa.arquivada_em is not null then
    update public.etapa e set arquivada_em = null, arquivada_por = null
     where e.id = v_etapa.id
    returning * into v_etapa;
    -- As publicações que ficaram paradas voltam à fila já (as de obra arquivada continuam
    -- paradas em reivindicar_publicacoes).
    update public.publicacao_telegram p
       set proxima_tentativa_em = now(), atualizado_em = now()
     where p.estado = 'pendente'
       and p.obra_id in (select o.id from public.obra o where o.etapa_id = v_etapa.id);
  end if;

  return jsonb_build_object('slug', v_etapa.slug, 'arquivada_em', v_etapa.arquivada_em);
end;
$$;

-- Limpa o grupo da etapa e o vínculo de tópico das obras dela.
create function public.admin_desvincular_etapa(p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  perform 1 from public.etapa e where e.id = v_etapa.id for update;
  update public.etapa e set telegram_chat_id = null, telegram_chat_titulo = null where e.id = v_etapa.id;
  update public.obra o set telegram_chat_id = null, telegram_thread_id = null where o.etapa_id = v_etapa.id;
end;
$$;

-- {obras: [{slug, nome}], total: <formato de admin_resumo_obra, somado>}
create function public.admin_resumo_etapa(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  return jsonb_build_object(
    'obras', coalesce((
      select jsonb_agg(jsonb_build_object('slug', o.slug, 'nome', o.nome) order by o.ordem, o.nome)
        from public.obra o where o.etapa_id = v_etapa.id
    ), '[]'::jsonb),
    'total', privado.resumo_etapa(v_etapa.id)
  );
end;
$$;

-- A confirmação é o nome da etapa, exatamente (só espaços nas pontas são ignorados). Apaga cada
-- obra como admin_excluir_obra (uma linha em obra_excluida por obra, com etapa_nome) e depois a
-- etapa. Retorno: {etapa_id, exclusoes: [uuid], resumo: <admin_resumo_etapa>}.
create function public.admin_excluir_etapa(p_slug text, p_confirmacao text)
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
  delete from public.etapa e where e.id = v_etapa.id;

  return jsonb_build_object('etapa_id', v_etapa.id, 'exclusoes', to_jsonb(v_exclusoes), 'resumo', v_resumo);
end;
$$;

-- Site de administração: organização --------------------------------------------------------------

-- {nome, logo_path}: campo ausente mantém o valor; logo_path null tira o logo; se informado,
-- precisa seguir o formato e já estar no bucket `organizacao`.
create function public.admin_salvar_organizacao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_logo text;
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
    if not exists (select 1 from storage.objects so where so.bucket_id = 'organizacao' and so.name = v_logo) then
      raise exception 'O logo % não foi enviado ao bucket organizacao', v_logo using errcode = '22023';
    end if;
  end if;

  insert into public.organizacao (id) values (true) on conflict (id) do nothing;
  update public.organizacao o
     set nome = coalesce(v_nome, o.nome),
         logo_path = case when p ? 'logo_path' then v_logo else o.logo_path end,
         atualizado_em = now(), atualizado_por = auth.uid()
   where o.id
  returning * into v_org;

  return jsonb_build_object('nome', v_org.nome, 'logo_path', v_org.logo_path);
end;
$$;

-- Site de administração: obras ganham a etapa ------------------------------------------------------

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
  arquivada_em timestamptz,
  etapa_id uuid,
  etapa_slug text,
  etapa_nome text,
  etapa_arquivada_em timestamptz
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
         o.arquivada_em,
         e.id, e.slug, e.nome, e.arquivada_em
    from public.obra o
    join public.etapa e on e.id = o.etapa_id
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
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  select * into v_etapa from public.etapa e where e.id = v_obra.etapa_id;
  return jsonb_build_object(
    'obra', jsonb_build_object(
      'id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome, 'ordem', v_obra.ordem,
      'telegram_vinculado', v_obra.telegram_chat_id is not null,
      'arquivada_em', v_obra.arquivada_em,
      'etapa', jsonb_build_object(
        'id', v_etapa.id, 'slug', v_etapa.slug, 'nome', v_etapa.nome,
        'arquivada_em', v_etapa.arquivada_em,
        'telegram_vinculado', v_etapa.telegram_chat_id is not null
      )
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

-- Cria (sem `id`; etapa_id obrigatório) ou edita (com `id`) uma obra. O slug não muda. Na edição,
-- `etapa_id` move a obra; se o grupo da nova etapa for outro, o vínculo com o tópico é apagado.
create or replace function public.admin_salvar_obra(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text;
  v_nome text;
  v_ordem int;
  v_etapa_id uuid;
  v_etapa public.etapa;
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da obra inválidos' using errcode = '22023';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    v_id := privado.uuid_ou_nulo(p ->> 'id');
    if v_id is null then
      raise exception 'Identificador da obra inválido' using errcode = '22023';
    end if;
  end if;
  if p ? 'slug' and jsonb_typeof(p -> 'slug') not in ('string', 'null') then
    raise exception 'O slug precisa ser texto' using errcode = '22023';
  end if;
  if p ? 'nome' and jsonb_typeof(p -> 'nome') not in ('string', 'null') then
    raise exception 'O nome precisa ser texto' using errcode = '22023';
  end if;
  if p ? 'etapa_id' and jsonb_typeof(p -> 'etapa_id') <> 'null' then
    v_etapa_id := privado.uuid_ou_nulo(p ->> 'etapa_id');
    if jsonb_typeof(p -> 'etapa_id') <> 'string' or v_etapa_id is null then
      raise exception 'Identificador da etapa inválido' using errcode = '22023';
    end if;
  end if;
  v_slug := p ->> 'slug';
  v_nome := btrim(p ->> 'nome');
  v_ordem := privado.inteiro_jsonb(p -> 'ordem', 'ordem');

  if v_nome is not null and (v_nome = '' or char_length(v_nome) > 120) then
    raise exception 'Informe o nome da obra (até 120 caracteres)' using errcode = '22023';
  end if;

  if v_id is null then
    if v_slug is null or v_slug !~ '^[a-z0-9-]+$' or char_length(v_slug) > 40 then
      raise exception 'Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)'
        using errcode = '22023';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome da obra (até 120 caracteres)' using errcode = '22023';
    end if;
    if v_etapa_id is null then
      raise exception 'Informe a etapa da obra' using errcode = '22023';
    end if;
  end if;

  if v_etapa_id is not null then
    select * into v_etapa from public.etapa e where e.id = v_etapa_id for share;
    if not found then
      raise exception 'Etapa não encontrada' using errcode = 'P0002';
    end if;
  end if;

  if v_id is null then
    if exists (select 1 from public.obra o where o.slug = v_slug) then
      raise exception 'Já existe uma obra com o slug %', v_slug using errcode = '23505';
    end if;
    insert into public.obra (slug, nome, ordem, etapa_id)
    values (v_slug, v_nome, coalesce(v_ordem, 0), v_etapa_id)
    returning * into v_obra;
  else
    select * into v_obra from public.obra o where o.id = v_id for update;
    if not found then
      raise exception 'Obra não encontrada' using errcode = 'P0002';
    end if;
    if v_slug is not null and v_slug <> v_obra.slug then
      raise exception 'O slug não pode ser alterado depois de criado' using errcode = '22023';
    end if;
    update public.obra o
       set nome = coalesce(v_nome, o.nome), ordem = coalesce(v_ordem, o.ordem)
     where o.id = v_id
    returning * into v_obra;
    if v_etapa_id is not null and v_etapa_id <> v_obra.etapa_id then
      update public.obra o
         set etapa_id = v_etapa_id,
             telegram_chat_id = case when v_etapa.telegram_chat_id is not distinct from o.telegram_chat_id
                                     then o.telegram_chat_id end,
             telegram_thread_id = case when v_etapa.telegram_chat_id is not distinct from o.telegram_chat_id
                                       then o.telegram_thread_id end
       where o.id = v_id
      returning * into v_obra;
    end if;
  end if;

  return jsonb_build_object('id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome, 'ordem', v_obra.ordem,
                            'etapa_id', v_obra.etapa_id);
end;
$$;

-- Últimas 50 exclusões, da mais recente; cada item ganha `etapa_nome`.
create or replace function public.admin_listar_exclusoes()
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
             'arquivos_erro', x.arquivos_erro, 'etapa_nome', x.etapa_nome
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

revoke execute on function public.admin_listar_etapas() from public, anon;
revoke execute on function public.admin_salvar_etapa(jsonb) from public, anon;
revoke execute on function public.admin_arquivar_etapa(text, boolean) from public, anon;
revoke execute on function public.admin_desvincular_etapa(text) from public, anon;
revoke execute on function public.admin_resumo_etapa(text) from public, anon;
revoke execute on function public.admin_excluir_etapa(text, text) from public, anon;
revoke execute on function public.admin_salvar_organizacao(jsonb) from public, anon;
grant execute on function public.admin_listar_etapas() to authenticated;
grant execute on function public.admin_salvar_etapa(jsonb) to authenticated;
grant execute on function public.admin_arquivar_etapa(text, boolean) to authenticated;
grant execute on function public.admin_desvincular_etapa(text) to authenticated;
grant execute on function public.admin_resumo_etapa(text) to authenticated;
grant execute on function public.admin_excluir_etapa(text, text) to authenticated;
grant execute on function public.admin_salvar_organizacao(jsonb) to authenticated;
