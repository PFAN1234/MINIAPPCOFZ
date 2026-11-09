-- Fase 2: tabelas, restrições e índices do schema public.
-- Contrato: docs/esquema-fase2.md

create table public.obra (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  nome text not null,
  ordem int not null default 0,
  telegram_chat_id bigint,
  telegram_thread_id bigint,
  criado_em timestamptz not null default now(),
  constraint obra_slug_unico unique (slug),
  constraint obra_slug_formato check (slug ~ '^[a-z0-9-]+$')
);

create table public.usuario (
  id uuid primary key references auth.users (id) on delete cascade,
  telegram_id bigint not null,
  nome text not null,
  username text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint usuario_telegram_id_unico unique (telegram_id)
);

create table public.participacao (
  obra_id uuid not null references public.obra (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  papel text not null,
  criado_em timestamptz not null default now(),
  primary key (obra_id, usuario_id),
  constraint participacao_papel_valido check (papel in ('equipe', 'gestor'))
);

create table public.solicitacao_acesso (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  estado text not null default 'pendente',
  criado_em timestamptz not null default now(),
  decidido_por uuid references public.usuario (id) on delete set null,
  decidido_em timestamptz,
  constraint solicitacao_estado_valido check (estado in ('pendente', 'aprovada', 'recusada'))
);
create unique index solicitacao_pendente_unica
  on public.solicitacao_acesso (obra_id, usuario_id) where estado = 'pendente';

create table public.pavimento (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  codigo text not null,
  nome text not null,
  ordem int not null default 0,
  constraint pavimento_codigo_unico unique (obra_id, codigo),
  constraint pavimento_id_obra_unico unique (id, obra_id)
);

create table public.ambiente (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  pavimento_id uuid not null,
  codigo text not null,
  nome_operacional text not null,
  nome_planta text,
  categoria text,
  area_m2 numeric(8, 2),
  revisao_planta text,
  marcadores jsonb not null default '[]'::jsonb,
  ordem int not null default 0,
  constraint ambiente_codigo_unico unique (obra_id, codigo),
  constraint ambiente_id_obra_unico unique (id, obra_id),
  constraint ambiente_pavimento_fk foreign key (pavimento_id, obra_id)
    references public.pavimento (id, obra_id) on delete cascade
);

create table public.registro (
  id uuid primary key,  -- gerado no cliente; serve de chave de idempotência
  obra_id uuid not null references public.obra (id) on delete cascade,
  ambiente_id uuid not null,
  tipo text not null,
  legenda text not null,
  autor_id uuid not null references public.usuario (id),
  capturado_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  situacao text,
  constraint registro_id_obra_unico unique (id, obra_id),
  constraint registro_ambiente_fk foreign key (ambiente_id, obra_id)
    references public.ambiente (id, obra_id),
  constraint registro_tipo_valido check (tipo in ('servico', 'pendencia')),
  constraint registro_legenda_tamanho check (char_length(legenda) <= 1000 and legenda !~ '^\s*$'),
  constraint registro_situacao_coerente check (
    (tipo = 'servico' and situacao is null)
    or (tipo = 'pendencia' and situacao in ('aberta', 'resolvida'))
  )
);

create table public.encerramento (
  id uuid primary key,  -- gerado no cliente
  registro_id uuid not null,
  obra_id uuid not null,
  gestor_id uuid not null references public.usuario (id),
  observacao text,
  encerrado_em timestamptz not null default now(),
  constraint encerramento_registro_unico unique (registro_id),
  constraint encerramento_id_obra_unico unique (id, obra_id),
  constraint encerramento_registro_fk foreign key (registro_id, obra_id)
    references public.registro (id, obra_id) on delete cascade,
  constraint encerramento_observacao_tamanho check (observacao is null or char_length(observacao) <= 1000)
);

create table public.foto (
  id uuid primary key,  -- gerado no cliente
  obra_id uuid not null references public.obra (id) on delete cascade,
  registro_id uuid,
  encerramento_id uuid,
  storage_path text not null,
  largura int not null,
  altura int not null,
  bytes int not null,
  ordem int not null,
  criado_em timestamptz not null default now(),
  constraint foto_storage_path_unico unique (storage_path),
  constraint foto_registro_fk foreign key (registro_id, obra_id)
    references public.registro (id, obra_id) on delete cascade,
  constraint foto_encerramento_fk foreign key (encerramento_id, obra_id)
    references public.encerramento (id, obra_id) on delete cascade,
  constraint foto_um_dono check (num_nonnulls(registro_id, encerramento_id) = 1),
  constraint foto_inteiros_positivos check (largura > 0 and altura > 0 and bytes > 0 and ordem >= 0)
);

create table public.publicacao_telegram (
  id bigint generated always as identity primary key,
  obra_id uuid not null references public.obra (id) on delete cascade,
  registro_id uuid,
  encerramento_id uuid,
  estado text not null default 'pendente',
  tentativas int not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  message_ids bigint[],
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint publicacao_registro_fk foreign key (registro_id, obra_id)
    references public.registro (id, obra_id) on delete cascade,
  constraint publicacao_encerramento_fk foreign key (encerramento_id, obra_id)
    references public.encerramento (id, obra_id) on delete cascade,
  constraint publicacao_um_dono check (num_nonnulls(registro_id, encerramento_id) = 1),
  constraint publicacao_estado_valido check (
    estado in ('pendente', 'enviando', 'publicado', 'incerto', 'falhou')
  )
);

-- Índices para as consultas do app e para as chaves estrangeiras.
create index registro_ambiente_recebido_idx on public.registro (ambiente_id, recebido_em desc);
create index registro_obra_tipo_situacao_idx on public.registro (obra_id, tipo, situacao);
create index foto_registro_idx on public.foto (registro_id);
create index foto_encerramento_idx on public.foto (encerramento_id);
create index participacao_usuario_idx on public.participacao (usuario_id);
create index publicacao_fila_idx on public.publicacao_telegram (estado, proxima_tentativa_em);
create index ambiente_pavimento_idx on public.ambiente (pavimento_id, obra_id);
create index solicitacao_usuario_idx on public.solicitacao_acesso (usuario_id);
create unique index publicacao_registro_unica on public.publicacao_telegram (registro_id) where registro_id is not null;
create unique index publicacao_encerramento_unica on public.publicacao_telegram (encerramento_id) where encerramento_id is not null;
