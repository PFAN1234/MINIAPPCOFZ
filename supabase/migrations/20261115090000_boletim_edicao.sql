-- Boletim de Acompanhamento Diário, parte 4: aba Boletins e edição do boletim emitido.
-- Contrato: docs/contrato-boletim.md ("Parte 4").
--
-- - `boletim_rascunho`: rascunho da edição de um boletim emitido (só pelas RPCs do site).
-- - `boletim_emissao` e `boletim` ganham `base_boletim_id` e `edicao`: a retificação editada parte
--   do snapshot do boletim de base e aplica a edição (textos trocados, itens e fotos ocultos).
-- - RPCs do site: lista geral de boletins, boletim (editor), salvar rascunho e retificar.
-- - Gerador: `reivindicar_emissoes` devolve base e edição; `boletim_snapshot_emitido`;
--   `concluir_emissao` copia base e edição e apaga o rascunho do boletim de base.
-- - Storage: o admin lê o bucket `fotos` (URLs assinadas no editor).

-- Tabelas e colunas ------------------------------------------------------------------------------

create table public.boletim_rascunho (
  boletim_id uuid primary key references public.boletim (id) on delete cascade,
  edicao jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);
comment on table public.boletim_rascunho is
  'Rascunho da edição de um boletim emitido. Sem acesso direto: o site usa admin_boletim/admin_salvar_rascunho_boletim/admin_retificar_boletim.';
alter table public.boletim_rascunho enable row level security;
revoke all on public.boletim_rascunho from public, anon, authenticated;

alter table public.boletim_emissao
  add column base_boletim_id uuid references public.boletim (id) on delete set null,
  add column edicao jsonb,
  add constraint boletim_emissao_edicao_coerente check ((base_boletim_id is null) = (edicao is null));
alter table public.boletim
  add column base_boletim_id uuid references public.boletim (id) on delete set null,
  add column edicao jsonb,
  add constraint boletim_edicao_coerente check ((base_boletim_id is null) = (edicao is null));
comment on column public.boletim.base_boletim_id is 'Boletim editado que originou esta retificação (null = sem edição).';
comment on column public.boletim.edicao is 'Edição aplicada ao snapshot do boletim de base: {textos, ocultos, fotos_ocultas}.';

-- Storage: o site mostra as fotos no editor por URL assinada ------------------------------------

create policy fotos_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and privado.eh_admin());

-- Funções auxiliares (privado) ------------------------------------------------------------------

-- Formato da edição: objeto só com `textos` (objeto de strings de até 2000 caracteres), `ocultos` e
-- `fotos_ocultas` (arrays de strings, até 500 itens); todas opcionais. Inválida → 22023.
create function privado.validar_edicao(p_edicao jsonb)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_chave text;
  v_valor jsonb;
  v_item jsonb;
begin
  if p_edicao is null or jsonb_typeof(p_edicao) <> 'object' then
    raise exception 'Edição do boletim inválida' using errcode = '22023';
  end if;
  for v_chave, v_valor in select k.key, k.value from jsonb_each(p_edicao) k loop
    if v_chave = 'textos' then
      if jsonb_typeof(v_valor) <> 'object' then
        raise exception 'Edição do boletim inválida' using errcode = '22023';
      end if;
      for v_item in select t.value from jsonb_each(v_valor) t loop
        if jsonb_typeof(v_item) <> 'string' or char_length(v_item #>> '{}') > 2000 then
          raise exception 'Edição do boletim inválida' using errcode = '22023';
        end if;
      end loop;
    elsif v_chave in ('ocultos', 'fotos_ocultas') then
      if jsonb_typeof(v_valor) <> 'array' or jsonb_array_length(v_valor) > 500 then
        raise exception 'Edição do boletim inválida' using errcode = '22023';
      end if;
      for v_item in select a.value from jsonb_array_elements(v_valor) a loop
        if jsonb_typeof(v_item) <> 'string' then
          raise exception 'Edição do boletim inválida' using errcode = '22023';
        end if;
      end loop;
    else
      raise exception 'Edição do boletim inválida' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke execute on function privado.validar_edicao(jsonb) from public, anon, authenticated;

-- Edição (já validada) sem nenhum texto, item oculto ou foto oculta.
create function privado.edicao_vazia(p_edicao jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(p_edicao -> 'textos', '{}'::jsonb) = '{}'::jsonb
     and coalesce(p_edicao -> 'ocultos', '[]'::jsonb) = '[]'::jsonb
     and coalesce(p_edicao -> 'fotos_ocultas', '[]'::jsonb) = '[]'::jsonb;
$$;
revoke execute on function privado.edicao_vazia(jsonb) from public, anon, authenticated;

-- Boletim no formato da lista do site (o mesmo de admin_listar_boletins).
create function privado.boletim_json(p public.boletim)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', p.id, 'data', p.data, 'revisao', p.revisao, 'numero', p.numero, 'emitido_em', p.emitido_em,
           'emitido_por_nome', privado.nome_pessoa(p.emitido_por), 'pdf_path', p.pdf_path,
           'publicado', coalesce(pt.estado = 'publicado', false),
           'publicacao_estado', pt.estado,
           'publicacao_erro', pt.erro,
           'publicacao_tentativas', coalesce(pt.tentativas, 0)
         )
    from (select 1) x
    left join public.publicacao_telegram pt on pt.boletim_id = p.id;
$$;
revoke execute on function privado.boletim_json(public.boletim) from public, anon, authenticated;

-- Mesma saída de antes.
create or replace function public.admin_listar_boletins(p_slug text)
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
    'boletins', coalesce((
      select jsonb_agg(privado.boletim_json(b) order by b.data desc, b.revisao desc)
        from public.boletim b
       where b.etapa_id = v_etapa.id
    ), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(privado.pedido_emissao_json(q) order by q.data desc, q.revisao desc, q.id desc)
        from public.boletim_emissao q
       where q.etapa_id = v_etapa.id and q.estado <> 'emitido'
    ), '[]'::jsonb)
  );
end;
$$;

-- RPCs do gerador (service_role) ------------------------------------------------------------------

-- Como antes, com `base_boletim_id` e `edicao` em cada pedido.
create or replace function public.reivindicar_emissoes(p_limite int default 3)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote jsonb;
begin
  update public.boletim_emissao q
     set estado = 'falhou', erro = 'Geração interrompida; tentativas esgotadas.', atualizado_em = now()
   where q.estado = 'gerando' and q.atualizado_em < now() - interval '15 minutes' and q.tentativas >= 8;

  with lote as (
    update public.boletim_emissao q
       set estado = 'gerando', tentativas = q.tentativas + 1, atualizado_em = now()
     where q.id in (
       select x.id from public.boletim_emissao x
        where (x.estado = 'pendente' and x.proxima_tentativa <= now())
           or (x.estado = 'gerando' and x.atualizado_em < now() - interval '15 minutes')
        order by x.proxima_tentativa, x.id
        limit greatest(coalesce(p_limite, 3), 0)
        for update skip locked
     )
    returning q.id, q.etapa_id, q.data, q.revisao, q.base_boletim_id, q.edicao
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'etapa_id', l.etapa_id, 'data', l.data, 'revisao', l.revisao,
           'numero', privado.numero_boletim(l.etapa_id, l.data, l.revisao),
           'base_boletim_id', l.base_boletim_id, 'edicao', l.edicao
         ) order by l.id), '[]'::jsonb)
    into v_lote
    from lote l;
  return v_lote;
end;
$$;

-- O snapshot gravado de um boletim emitido (base de uma retificação editada). Inexistente → P0002.
create function public.boletim_snapshot_emitido(p_boletim uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  select b.snapshot into v_snapshot from public.boletim b where b.id = p_boletim;
  if not found then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  return v_snapshot;
end;
$$;
revoke execute on function public.boletim_snapshot_emitido(uuid) from public, anon, authenticated;
grant execute on function public.boletim_snapshot_emitido(uuid) to service_role;

-- Como antes; o boletim também recebe base e edição do pedido, e o rascunho do boletim de base
-- é apagado.
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
  if not exists (select 1 from storage.objects so where so.bucket_id = 'boletins' and so.name = v_caminho) then
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

-- RPCs do site (admin) ----------------------------------------------------------------------------

-- {boletins, pedidos} como admin_listar_boletins, de todas as etapas (ou só de `p_etapa`, slug;
-- inexistente → P0002), com data entre p_de e p_ate (inclusivo, quando dados). Boletim: + etapa_slug,
-- etapa_nome, base_numero, editado, tem_rascunho. Pedido: + etapa_slug, etapa_nome, editado.
-- Ordem: data desc, etapa, revisão desc. Até 300 boletins.
create function public.admin_listar_todos_boletins(
  p_etapa text default null, p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa uuid;
begin
  perform privado.exigir_admin();
  if p_etapa is not null then
    v_etapa := (privado.etapa_do_slug(p_etapa)).id;
  end if;
  return jsonb_build_object(
    'boletins', coalesce((
      select jsonb_agg(privado.boletim_json(t.b) || jsonb_build_object(
               'etapa_slug', t.slug, 'etapa_nome', t.nome, 'base_numero', t.base_numero,
               'editado', (t.b).edicao is not null, 'tem_rascunho', t.tem_rascunho
             ) order by (t.b).data desc, t.nome, (t.b).revisao desc)
        from (
          select b, e.slug, e.nome, bb.numero as base_numero,
                 exists (select 1 from public.boletim_rascunho r where r.boletim_id = b.id) as tem_rascunho
            from public.boletim b
            join public.etapa e on e.id = b.etapa_id
            left join public.boletim bb on bb.id = b.base_boletim_id
           where (v_etapa is null or b.etapa_id = v_etapa)
             and (p_de is null or b.data >= p_de)
             and (p_ate is null or b.data <= p_ate)
           order by b.data desc, e.nome, b.revisao desc
           limit 300
        ) t
    ), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(privado.pedido_emissao_json(q) || jsonb_build_object(
               'etapa_slug', e.slug, 'etapa_nome', e.nome, 'editado', q.edicao is not null
             ) order by q.data desc, e.nome, q.revisao desc, q.id desc)
        from public.boletim_emissao q
        join public.etapa e on e.id = q.etapa_id
       where q.estado <> 'emitido'
         and (v_etapa is null or q.etapa_id = v_etapa)
         and (p_de is null or q.data >= p_de)
         and (p_ate is null or q.data <= p_ate)
    ), '[]'::jsonb)
  );
end;
$$;

-- Um boletim para o editor. Inexistente → P0002.
create function public.admin_boletim(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b public.boletim;
  v_etapa public.etapa;
  v_r public.boletim_rascunho;
  v_base_numero text;
begin
  perform privado.exigir_admin();
  select * into v_b from public.boletim b where b.id = p_id;
  if not found then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  select * into v_etapa from public.etapa e where e.id = v_b.etapa_id;
  select * into v_r from public.boletim_rascunho r where r.boletim_id = p_id;
  select bb.numero into v_base_numero from public.boletim bb where bb.id = v_b.base_boletim_id;

  return jsonb_build_object(
    'id', v_b.id, 'etapa_slug', v_etapa.slug, 'etapa_nome', v_etapa.nome, 'data', v_b.data,
    'revisao', v_b.revisao, 'numero', v_b.numero, 'emitido_em', v_b.emitido_em,
    'emitido_por_nome', privado.nome_pessoa(v_b.emitido_por), 'pdf_path', v_b.pdf_path,
    'publicado', exists (select 1 from public.publicacao_telegram pt
                          where pt.boletim_id = p_id and pt.estado = 'publicado'),
    'publicacao_estado', (select pt.estado from public.publicacao_telegram pt where pt.boletim_id = p_id),
    'ultima_revisao', not exists (select 1 from public.boletim x
                                   where x.etapa_id = v_b.etapa_id and x.data = v_b.data and x.revisao > v_b.revisao),
    'emissao_em_andamento', exists (select 1 from public.boletim_emissao q
                                     where q.etapa_id = v_b.etapa_id and q.data = v_b.data
                                       and q.estado in ('pendente', 'gerando')),
    'base_numero', v_base_numero,
    'edicao', v_b.edicao,
    'snapshot', v_b.snapshot,
    'rascunho', case when v_r.boletim_id is null then null else jsonb_build_object(
      'edicao', v_r.edicao, 'atualizado_em', v_r.atualizado_em,
      'atualizado_por_nome', privado.nome_pessoa(v_r.atualizado_por)) end
  );
end;
$$;

-- Salva (ou, edição vazia, apaga) o rascunho. Só a última revisão do dia. Retorno: {atualizado_em} ou null.
create function public.admin_salvar_rascunho_boletim(p_id uuid, p_edicao jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.boletim;
  v_em timestamptz;
begin
  perform privado.exigir_admin();
  perform privado.validar_edicao(p_edicao);
  select * into v_b from public.boletim b where b.id = p_id;
  if not found then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.boletim x
              where x.etapa_id = v_b.etapa_id and x.data = v_b.data and x.revisao > v_b.revisao) then
    raise exception 'Só a última revisão do dia pode ser editada' using errcode = '22023';
  end if;
  if privado.edicao_vazia(p_edicao) then
    delete from public.boletim_rascunho r where r.boletim_id = p_id;
    return null;
  end if;
  insert into public.boletim_rascunho (boletim_id, edicao, atualizado_em, atualizado_por)
  values (p_id, p_edicao, now(), auth.uid())
  on conflict (boletim_id) do update
     set edicao = excluded.edicao, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por
  returning atualizado_em into v_em;
  return jsonb_build_object('atualizado_em', v_em);
end;
$$;

-- Pede a retificação editada do boletim: próxima revisão do dia, com base e edição. Mesmo retorno de
-- admin_pedir_emissao (pedido + `numero`). Erros: P0002 (inexistente), 22023 (não é a última revisão,
-- edição inválida ou vazia), 23505 (emissão em andamento no dia).
create function public.admin_retificar_boletim(p_id uuid, p_edicao jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.boletim;
  v_etapa public.etapa;
  v_revisao int;
  v_numero text;
  v_pedido public.boletim_emissao;
begin
  perform privado.exigir_admin();
  perform privado.validar_edicao(p_edicao);
  select * into v_b from public.boletim b where b.id = p_id;
  if not found then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  -- Serializa os pedidos da etapa.
  select * into v_etapa from public.etapa e where e.id = v_b.etapa_id for update;
  if exists (select 1 from public.boletim x
              where x.etapa_id = v_b.etapa_id and x.data = v_b.data and x.revisao > v_b.revisao) then
    raise exception 'Só a última revisão do dia pode ser editada' using errcode = '22023';
  end if;
  if privado.edicao_vazia(p_edicao) then
    raise exception 'Nenhuma alteração para enviar' using errcode = '22023';
  end if;
  if exists (select 1 from public.boletim_emissao q
              where q.etapa_id = v_b.etapa_id and q.data = v_b.data and q.estado in ('pendente', 'gerando')) then
    raise exception 'Já há uma emissão em andamento para este dia' using errcode = '23505';
  end if;

  select coalesce(max(x.revisao) + 1, 0) into v_revisao
    from public.boletim x where x.etapa_id = v_b.etapa_id and x.data = v_b.data;
  v_numero := privado.numero_boletim(v_b.etapa_id, v_b.data, v_revisao);

  insert into public.boletim_emissao (etapa_id, data, revisao, pedido_por, base_boletim_id, edicao)
  values (v_b.etapa_id, v_b.data, v_revisao, auth.uid(), p_id, p_edicao)
  on conflict (etapa_id, data, revisao) do update
     set estado = 'pendente', tentativas = 0, proxima_tentativa = now(), erro = null,
         pedido_por = excluded.pedido_por, base_boletim_id = excluded.base_boletim_id,
         edicao = excluded.edicao, atualizado_em = now()
   where public.boletim_emissao.estado = 'falhou'
  returning * into v_pedido;
  if not found then
    raise exception 'Já há uma emissão em andamento para este dia' using errcode = '23505';
  end if;

  insert into public.boletim_rascunho (boletim_id, edicao, atualizado_em, atualizado_por)
  values (p_id, p_edicao, now(), auth.uid())
  on conflict (boletim_id) do update
     set edicao = excluded.edicao, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;

  perform privado.disparar_gerador();
  return privado.pedido_emissao_json(v_pedido) || jsonb_build_object('numero', v_numero);
end;
$$;

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function public.admin_listar_todos_boletins(text, date, date) from public, anon;
revoke execute on function public.admin_boletim(uuid) from public, anon;
revoke execute on function public.admin_salvar_rascunho_boletim(uuid, jsonb) from public, anon;
revoke execute on function public.admin_retificar_boletim(uuid, jsonb) from public, anon;
grant execute on function public.admin_listar_todos_boletins(text, date, date) to authenticated;
grant execute on function public.admin_boletim(uuid) to authenticated;
grant execute on function public.admin_salvar_rascunho_boletim(uuid, jsonb) to authenticated;
grant execute on function public.admin_retificar_boletim(uuid, jsonb) to authenticated;
