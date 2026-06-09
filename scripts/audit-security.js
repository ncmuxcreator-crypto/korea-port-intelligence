import pg from "pg";

const { Client } = pg;

const CRITICAL_TABLES = new Set([
  "vessel_master",
  "vessel_snapshots",
  "vessel_entities",
  "port_call_master",
  "opportunity_master",
  "risk_history",
  "commercial_leads",
  "operator_contact_history",
  "sales_candidates_current",
  "immediate_targets_current",
  "dashboard_summary_snapshots",
  "active_dataset_pointer",
  "vessel_visits",
  "feature_store",
  "feature_snapshots",
  "explainability_snapshots",
  "rule_evaluations"
]);

function databaseUrl() {
  return process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
}

function riskLevel(row) {
  if (!row.rls_enabled && (CRITICAL_TABLES.has(row.table_name) || row.anon_access_possible)) return "CRITICAL";
  if (!row.rls_enabled) return "WARNING";
  if (row.anon_access_possible) return "WARNING";
  return "SAFE";
}

function recommendation(row) {
  if (!row.rls_enabled) return "Enable RLS; revoke anon/authenticated grants; service-role only.";
  if (row.anon_access_possible) return "Review anon/authenticated grants and policies; prefer static JSON or server-side service-role access.";
  return "No public table exposure detected.";
}

function yes(value) {
  return value ? "yes" : "no";
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined).map(String);
  if (value === null || value === undefined) return [];
  if (typeof value === "string" && value.trim() === "{}") return [];
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    return value
      .slice(1, -1)
      .split(",")
      .map(item => item.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [String(value)];
}

function printTable(rows) {
  console.log("Table | RLS | Risk | Recommendation");
  console.log("--- | --- | --- | ---");
  for (const row of rows) {
    console.log(`${row.table_name} | ${yes(row.rls_enabled)} | ${row.public_risk_level} | ${row.recommendation}`);
  }
}

function printDetails(rows) {
  console.log("\nDetailed security audit:");
  for (const row of rows) {
    console.log(`- ${row.table_name}`);
    console.log(`  row_count: ${row.row_count}`);
    console.log(`  rls_enabled: ${yes(row.rls_enabled)}`);
    console.log(`  anon_access_possible: ${yes(row.anon_access_possible)}`);
    console.log(`  service_role_access: ${yes(row.service_role_access)}`);
    console.log(`  public_risk_level: ${row.public_risk_level}`);
    if (row.public_grants.length) console.log(`  public_grants: ${row.public_grants.join(", ")}`);
    if (row.public_policies.length) console.log(`  public_policies: ${row.public_policies.join(", ")}`);
  }
}

function printMigration(rows) {
  const disabled = rows.filter(row => !row.rls_enabled);
  console.log("\nRLS-disabled migration statements:");
  if (!disabled.length) {
    console.log("-- none");
    return;
  }
  for (const row of disabled) {
    console.log(`ALTER TABLE public.${row.table_name} ENABLE ROW LEVEL SECURITY;`);
  }
}

async function fetchAuditRows(client) {
  const result = await client.query(`
    with public_tables as (
      select
        c.oid,
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced,
        coalesce(s.n_live_tup, c.reltuples, 0)::bigint as row_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
    ),
    grants as (
      select
        table_name,
        array_agg(distinct grantee || ':' || privilege_type order by grantee || ':' || privilege_type)
          filter (where grantee in ('anon', 'authenticated', 'public')) as public_grants,
        bool_or(grantee in ('anon', 'authenticated', 'public')) as has_public_grant,
        bool_or(grantee = 'service_role') as service_role_access
      from information_schema.role_table_grants
      where table_schema = 'public'
      group by table_name
    ),
    policies as (
      select
        tablename as table_name,
        array_agg(distinct policyname order by policyname)
          filter (
            where 'anon' = any(coalesce(roles, array[]::name[]))
               or 'authenticated' = any(coalesce(roles, array[]::name[]))
               or 'public' = any(coalesce(roles, array[]::name[]))
          ) as public_policies,
        bool_or(
          'anon' = any(coalesce(roles, array[]::name[]))
          or 'authenticated' = any(coalesce(roles, array[]::name[]))
          or 'public' = any(coalesce(roles, array[]::name[]))
        ) as has_public_policy
      from pg_policies
      where schemaname = 'public'
      group by tablename
    )
    select
      t.table_name,
      t.row_count,
      t.rls_enabled,
      coalesce(g.has_public_grant, false) as has_public_grant,
      coalesce(g.service_role_access, false) as service_role_access,
      coalesce(p.has_public_policy, false) as has_public_policy,
      coalesce(g.public_grants, array[]::text[]) as public_grants,
      coalesce(p.public_policies, array[]::text[]) as public_policies
    from public_tables t
    left join grants g on g.table_name = t.table_name
    left join policies p on p.table_name = t.table_name
    order by t.table_name;
  `);

  return result.rows.map(row => {
    const anonAccessPossible = Boolean(row.has_public_grant) && (!row.rls_enabled || Boolean(row.has_public_policy));
    const publicGrants = toArray(row.public_grants);
    const publicPolicies = toArray(row.public_policies);
    const auditRow = {
      ...row,
      anon_access_possible: anonAccessPossible,
      public_grants: publicGrants,
      public_policies: publicPolicies
    };
    return {
      ...auditRow,
      public_risk_level: riskLevel(auditRow),
      recommendation: recommendation(auditRow)
    };
  });
}

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.error("Missing SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL.");
    process.exit(2);
  }

  const client = new Client({
    connectionString: url,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    const rows = await fetchAuditRows(client);
    const counts = rows.reduce((acc, row) => {
      acc[row.public_risk_level] = (acc[row.public_risk_level] || 0) + 1;
      if (!row.rls_enabled) acc.rls_disabled += 1;
      if (CRITICAL_TABLES.has(row.table_name) && row.public_risk_level !== "SAFE") acc.critical_business_exposed += 1;
      return acc;
    }, { SAFE: 0, WARNING: 0, CRITICAL: 0, rls_disabled: 0, critical_business_exposed: 0 });

    console.log("Supabase RLS security audit");
    console.log(`public_tables: ${rows.length}`);
    console.log(`rls_disabled: ${counts.rls_disabled}`);
    console.log(`critical: ${counts.CRITICAL || 0}`);
    console.log(`warning: ${counts.WARNING || 0}`);
    console.log(`safe: ${counts.SAFE || 0}`);
    console.log(`critical_business_exposed: ${counts.critical_business_exposed}`);
    console.log("");
    printTable(rows);
    printDetails(rows);
    printMigration(rows);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`[SECURITY AUDIT ERROR] ${error.message}`);
  process.exit(1);
});
