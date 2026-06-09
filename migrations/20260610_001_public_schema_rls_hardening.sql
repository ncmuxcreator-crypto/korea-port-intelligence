-- Supabase public schema RLS hardening plan.
--
-- Generated for review only. Do not apply until the read-only
-- `npm run audit:security` output has been reviewed.
--
-- Intended architecture:
-- GitHub Actions -> Supabase -> latest static JSON snapshot -> Frontend.
-- The browser should not query public Supabase tables directly.

begin;

do $$
declare
  table_record record;
  policy_name text;
begin
  for table_record in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format(
      'alter table %I.%I enable row level security',
      table_record.schema_name,
      table_record.table_name
    );

    execute format(
      'revoke all on table %I.%I from anon, authenticated',
      table_record.schema_name,
      table_record.table_name
    );

    policy_name := left('deny_public_' || table_record.table_name, 63);

    execute format(
      'drop policy if exists %I on %I.%I',
      policy_name,
      table_record.schema_name,
      table_record.table_name
    );

    execute format(
      'create policy %I on %I.%I for all to anon, authenticated using (false) with check (false)',
      policy_name,
      table_record.schema_name,
      table_record.table_name
    );
  end loop;
end $$;

commit;

-- Optional verification after apply:
--
-- select
--   n.nspname as schema_name,
--   c.relname as table_name,
--   c.relrowsecurity as rls_enabled
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relkind in ('r', 'p')
-- order by c.relname;
--
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and grantee in ('anon', 'authenticated', 'public')
-- order by table_name, grantee, privilege_type;
