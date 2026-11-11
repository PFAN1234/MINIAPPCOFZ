-- Primeiros admins do site de administração (dados, não schema). Aplicar depois da migration
-- 20261111170000_admin.sql. Cada pessoa precisa ter aberto o Mini App ao menos uma vez (a linha
-- em `usuario` nasce no primeiro login); quem ainda não entrou é ignorado e basta rodar de novo.
-- Idempotente.

begin;

-- Patrício Ferreira
insert into public.admin_app (usuario_id)
select u.id from public.usuario u where u.telegram_id = 1362893349
on conflict (usuario_id) do nothing;

-- Eduardo Lima
insert into public.admin_app (usuario_id)
select u.id from public.usuario u where u.telegram_id = 669804829
on conflict (usuario_id) do nothing;

commit;

-- Conferência: quem ficou como admin.
select u.telegram_id, u.nome, a.criado_em
  from public.admin_app a join public.usuario u on u.id = a.usuario_id
 order by u.nome;
