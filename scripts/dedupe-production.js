import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const args = new Set(process.argv.slice(2).filter(arg => arg !== "scripts/dedupe-production.js"));
const apply = args.has("--apply");
const allRuns = args.has("--all-runs");
const cleanupId = `dedupe_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Missing SUPABASE_DB_URL or DATABASE_URL.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

function q(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function loadColumns(client) {
  const { rows } = await client.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set());
    map.get(row.table_name).add(row.column_name);
  }
  return map;
}

function has(columns, table, column) {
  return columns.get(table)?.has(column);
}

function col(columns, table, column, fallback = "null::text") {
  return has(columns, table, column) ? `${q(column)}::text` : fallback;
}

function numCol(columns, table, column) {
  return has(columns, table, column) ? `coalesce(${q(column)}::numeric, 0)` : "0";
}

function timeExpr(columns, table, names) {
  const available = names.filter(name => has(columns, table, name)).map(name => q(name));
  return available.length ? `coalesce(${available.join(", ")}, now())` : "now()";
}

function normalizedNameExpr(columns, table) {
  const parts = ["normalized_vessel_name", "normalized_name", "vessel_name", "canonical_name", "name"]
    .filter(name => has(columns, table, name))
    .map(name => q(name));
  if (!parts.length) return "null::text";
  return `nullif(upper(regexp_replace(coalesce(${parts.join(", ")}, ''), '[[:space:][:punct:]]+', '', 'g')), '')`;
}

function vesselIdentityExpr(columns, table) {
  const name = normalizedNameExpr(columns, table);
  const type = has(columns, table, "vessel_type_group")
    ? `coalesce(${q("vessel_type_group")}::text, '')`
    : has(columns, table, "vessel_type")
      ? `coalesce(${q("vessel_type")}::text, '')`
      : "''";
  const nameKey = `${name} || '|' || ${type}`;
  return `coalesce(
    nullif(${col(columns, table, "imo")}, ''),
    nullif(${nameKey}, '||'),
    nullif(${col(columns, table, "mmsi")}, ''),
    nullif(${col(columns, table, "call_sign")}, ''),
    nullif(${col(columns, table, "master_vessel_id")}, ''),
    nullif(${col(columns, table, "vessel_id")}, '')
  )`;
}

function vesselMasterIdentityExpr(columns, table) {
  const name = normalizedNameExpr(columns, table);
  const type = has(columns, table, "vessel_type_group")
    ? `coalesce(${q("vessel_type_group")}::text, '')`
    : has(columns, table, "vessel_type")
      ? `coalesce(${q("vessel_type")}::text, '')`
      : "''";
  const nameKey = `${name} || '|' || ${type}`;
  return `coalesce(
    nullif(${col(columns, table, "imo")}, ''),
    nullif(${nameKey}, '||'),
    nullif(${col(columns, table, "mmsi")}, ''),
    nullif(${col(columns, table, "call_sign")}, ''),
    nullif(${col(columns, table, "master_vessel_id")}, '')
  )`;
}

function runWhere(columns, table) {
  if (allRuns || !has(columns, table, "run_id")) return "true";
  return `${q("run_id")} = $1`;
}

function runExpr(columns, table) {
  return has(columns, table, "run_id") ? q("run_id") : "null::text";
}

function scoreExpr(columns, table) {
  return [
    "commercial_value_score",
    "total_sales_priority_score",
    "lead_priority_score",
    "data_confidence_score",
    "identity_confidence",
    "stay_hours"
  ].map(name => numCol(columns, table, name)).join(" + ");
}

function activeRunQueryArgs(activeRunId) {
  return allRuns ? [] : [activeRunId];
}

async function activeRunId(client) {
  const { rows } = await client.query("select active_run_id from active_dataset_pointer where id = 'current' limit 1");
  return rows[0]?.active_run_id || null;
}

async function ensureQuarantine(client) {
  await client.query(`
    create table if not exists duplicate_cleanup_quarantine (
      quarantine_id bigserial primary key,
      cleanup_id text not null,
      table_name text not null,
      duplicate_key text,
      kept_id text,
      deleted_id text,
      run_id text,
      row_data jsonb not null,
      quarantined_at timestamptz not null default now()
    )
  `);
}

async function dedupeTable(client, columns, config, activeRun) {
  if (!columns.has(config.table)) {
    return { table: config.table, skipped: true, reason: "missing_table" };
  }
  for (const required of config.required || []) {
    if (!has(columns, config.table, required)) {
      return { table: config.table, skipped: true, reason: `missing_column:${required}` };
    }
  }

  const table = q(config.table);
  const pk = q(config.pk);
  const key = config.key(columns, config.table);
  const where = config.where ? `(${config.where(columns, config.table)}) and (${runWhere(columns, config.table)})` : runWhere(columns, config.table);
  const order = config.order
    ? config.order(columns, config.table)
    : `${scoreExpr(columns, config.table)} desc, ${timeExpr(columns, config.table, ["updated_at", "last_seen_at", "last_seen", "collected_at", "created_at"])} desc, ${pk}::text desc`;
  const ranked = `
    with ranked as (
      select
        ${pk}::text as row_id,
        ${runExpr(columns, config.table)}::text as run_id,
        ${key}::text as duplicate_key,
        first_value(${pk}::text) over (partition by ${config.partition || key} order by ${order}) as kept_id,
        row_number() over (partition by ${config.partition || key} order by ${order}) as rn
      from ${table}
      where (${where}) and ${key} is not null and ${key}::text <> ''
    ),
    dupes as (
      select * from ranked where rn > 1
    )
  `;

  const params = activeRunQueryArgs(activeRun);
  const dry = await client.query(`${ranked} select count(*)::int as duplicate_rows, count(distinct duplicate_key)::int as duplicate_groups from dupes`, params);
  const duplicateRows = Number(dry.rows[0]?.duplicate_rows || 0);
  const duplicateGroups = Number(dry.rows[0]?.duplicate_groups || 0);
  if (!apply || duplicateRows === 0) {
    return { table: config.table, duplicateRows, duplicateGroups, applied: false };
  }

  await client.query("begin");
  try {
    await client.query(`${ranked}
      insert into duplicate_cleanup_quarantine (
        cleanup_id,
        table_name,
        duplicate_key,
        kept_id,
        deleted_id,
        run_id,
        row_data
      )
      select
        $${params.length + 1},
        $${params.length + 2},
        dupes.duplicate_key,
        dupes.kept_id,
        dupes.row_id,
        dupes.run_id,
        to_jsonb(t.*)
      from dupes
      join ${table} t on t.${config.pk}::text = dupes.row_id
    `, [...params, cleanupId, config.table]);

    const deleted = await client.query(`${ranked}
      delete from ${table} t
      using dupes
      where t.${config.pk}::text = dupes.row_id
      returning t.${config.pk}::text as deleted_id
    `, params);
    await client.query("commit");
    return { table: config.table, duplicateRows, duplicateGroups, deletedRows: deleted.rowCount, applied: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function dedupeVesselMaster(client, columns) {
  const tableName = "vessel_master";
  if (!columns.has(tableName)) return { table: tableName, skipped: true, reason: "missing_table" };
  const table = q(tableName);
  const pk = q("master_vessel_id");
  const key = vesselMasterIdentityExpr(columns, tableName);
  const order = `${scoreExpr(columns, tableName)} desc, ${timeExpr(columns, tableName, ["last_seen", "updated_at", "first_seen"])} desc, ${pk}::text desc`;
  const ranked = `
    with ranked as (
      select
        ${pk}::text as row_id,
        ${key}::text as duplicate_key,
        first_value(${pk}::text) over (partition by ${key} order by ${order}) as kept_id,
        row_number() over (partition by ${key} order by ${order}) as rn
      from ${table}
      where ${key} is not null and ${key}::text <> ''
    ),
    dupes as (
      select * from ranked where rn > 1
    )
  `;
  const dry = await client.query(`${ranked} select count(*)::int as duplicate_rows, count(distinct duplicate_key)::int as duplicate_groups from dupes`);
  const duplicateRows = Number(dry.rows[0]?.duplicate_rows || 0);
  const duplicateGroups = Number(dry.rows[0]?.duplicate_groups || 0);
  if (!apply || duplicateRows === 0) return { table: tableName, duplicateRows, duplicateGroups, applied: false };

  const referenceTables = [
    "vessel_snapshots",
    "port_call_master",
    "opportunity_master",
    "vessel_events",
    "risk_history",
    "feature_store",
    "feature_snapshots",
    "rule_evaluations",
    "explainability_snapshots",
    "model_training_rows",
    "vessel_snapshot_daily",
    "sales_candidates_current",
    "immediate_targets_current",
    "commercial_opportunity_daily"
  ].filter(name => columns.has(name) && has(columns, name, "master_vessel_id"));

  await client.query("begin");
  try {
    let updatedReferences = 0;
    for (const refTable of referenceTables) {
      const result = await client.query(`${ranked}
        update ${q(refTable)} t
        set master_vessel_id = dupes.kept_id
        from dupes
        where t.master_vessel_id = dupes.row_id
      `);
      updatedReferences += result.rowCount || 0;
    }

    await client.query(`${ranked}
      insert into duplicate_cleanup_quarantine (
        cleanup_id,
        table_name,
        duplicate_key,
        kept_id,
        deleted_id,
        run_id,
        row_data
      )
      select
        $1,
        $2,
        dupes.duplicate_key,
        dupes.kept_id,
        dupes.row_id,
        null,
        to_jsonb(t.*)
      from dupes
      join ${table} t on t.master_vessel_id = dupes.row_id
    `, [cleanupId, tableName]);

    const deleted = await client.query(`${ranked}
      delete from ${table} t
      using dupes
      where t.master_vessel_id = dupes.row_id
      returning t.master_vessel_id as deleted_id
    `);
    await client.query("commit");
    return { table: tableName, duplicateRows, duplicateGroups, deletedRows: deleted.rowCount, updatedReferences, applied: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function pruneStaleCurrentTables(client, columns, activeRun) {
  const tables = ["sales_candidates_current", "immediate_targets_current", "port_summary_current"];
  const results = [];
  if (!activeRun) return results;
  for (const table of tables) {
    if (!columns.has(table) || !has(columns, table, "run_id")) {
      results.push({ table, skipped: true, reason: "missing_table_or_run_id" });
      continue;
    }
    const dry = await client.query(`select count(*)::int as stale_rows from ${q(table)} where run_id is distinct from $1`, [activeRun]);
    const staleRows = Number(dry.rows[0]?.stale_rows || 0);
    if (!apply || staleRows === 0) {
      results.push({ table, staleRows, applied: false });
      continue;
    }
    await client.query("begin");
    try {
      const deletedIdExpr = ["current_id", "id", "port_unit_key", "run_id"]
        .filter(name => has(columns, table, name))
        .map(name => `${q(name)}::text`);
      await client.query(`
        insert into duplicate_cleanup_quarantine (
          cleanup_id,
          table_name,
          duplicate_key,
          kept_id,
          deleted_id,
          run_id,
          row_data
        )
        select
          $1,
          $2,
          'stale_current_row',
          $3,
          coalesce(${deletedIdExpr.length ? deletedIdExpr.join(", ") : "run_id::text"}),
          run_id::text,
          to_jsonb(t.*)
        from ${q(table)} t
        where run_id is distinct from $3
      `, [cleanupId, table, activeRun]);
      const deleted = await client.query(`delete from ${q(table)} where run_id is distinct from $1`, [activeRun]);
      await client.query("commit");
      results.push({ table, staleRows, deletedRows: deleted.rowCount, applied: true });
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  return results;
}

async function main() {
  const client = await pool.connect();
  try {
    const columns = await loadColumns(client);
    const activeRun = await activeRunId(client);
    if (!allRuns && !activeRun) throw new Error("active_dataset_pointer.current active_run_id is missing.");
    if (apply) await ensureQuarantine(client);

    const configs = [
      {
        table: "vessel_snapshots",
        pk: "id",
        required: ["id"],
        key: vesselIdentityExpr
      },
      {
        table: "port_call_master",
        pk: "port_call_id",
        required: ["port_call_id"],
        key: vesselIdentityExpr
      },
      {
        table: "opportunity_master",
        pk: "opportunity_id",
        required: ["opportunity_id"],
        key: vesselIdentityExpr
      },
      {
        table: "vessel_events",
        pk: "id",
        required: ["id"],
        key: (cols, table) => {
          const identity = vesselIdentityExpr(cols, table);
          const eventType = col(cols, table, "event_type");
          const eventTime = has(cols, table, "event_time")
            ? q("event_time")
            : has(cols, table, "event_at")
              ? q("event_at")
              : "now()";
          return `${identity} || '|' || coalesce(${eventType}, '') || '|' || coalesce(${eventTime}::text, '')`;
        },
        order: (cols, table) => `${timeExpr(cols, table, ["created_at", "event_time", "event_at"])} desc, ${q("id")} desc`
      }
    ];

    console.log(`Duplicate cleanup mode: ${apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`Scope: ${allRuns ? "all runs" : `active run ${activeRun}`}`);
    console.log(`cleanup_id: ${cleanupId}`);

    const results = [];
    results.push(await dedupeVesselMaster(client, columns));
    for (const config of configs) results.push(await dedupeTable(client, columns, config, activeRun));
    results.push(...await pruneStaleCurrentTables(client, columns, activeRun));

    console.log("");
    console.log("Duplicate cleanup report:");
    for (const result of results) {
      if (result.skipped) {
        console.log(`- ${result.table}: skipped (${result.reason})`);
        continue;
      }
      if (Number.isFinite(result.staleRows)) {
        const action = result.applied ? `deleted=${result.deletedRows || 0}` : "not applied";
        console.log(`- ${result.table}: stale_rows=${result.staleRows}, ${action}`);
        continue;
      }
      const action = result.applied ? `deleted=${result.deletedRows || 0}` : "not applied";
      const references = result.updatedReferences ? `, references_updated=${result.updatedReferences}` : "";
      console.log(`- ${result.table}: groups=${result.duplicateGroups}, rows=${result.duplicateRows}, ${action}${references}`);
    }
    if (!apply) console.log("\nRun with --apply to quarantine and delete duplicate rows.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async error => {
  console.error(error?.stack || error?.message || error);
  await pool.end();
  process.exit(1);
});
