import fs from "fs";
import path from "path";
import pg from "pg";

const { Client } = pg;

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
const ENV_FILES = [".env.local", ".env"];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const file of ENV_FILES) loadEnvFile(path.join(ROOT, file));

function databaseUrl() {
  return process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => /^\d{8}_\d{3}_.+\.sql$/i.test(file))
    .sort((left, right) => left.localeCompare(right));
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);
}

function checksum(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

async function appliedMap(client) {
  const result = await client.query("select filename, checksum from schema_migrations");
  return new Map(result.rows.map(row => [row.filename, row.checksum]));
}

async function applyMigration(client, filename, sql, hash, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[DRY RUN] ${filename}`);
    return;
  }
  console.log(`[APPLY] ${filename}`);
  await client.query(sql);
  await client.query(
    "insert into schema_migrations(filename, checksum) values($1, $2) on conflict(filename) do update set checksum = excluded.checksum, applied_at = now()",
    [filename, hash]
  );
}

async function main() {
  const url = databaseUrl();
  const dryRun = process.argv.includes("--dry-run");
  if (!url) {
    throw new Error("DATABASE_URL, SUPABASE_DB_URL, or POSTGRES_URL is required to apply production migrations.");
  }
  const client = new Client({
    connectionString: url,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await ensureLedger(client);
    const applied = await appliedMap(client);
    const files = migrationFiles();
    let pending = 0;
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
      const hash = checksum(sql);
      if (applied.get(filename) === hash) {
        console.log(`[SKIP] ${filename}`);
        continue;
      }
      pending += 1;
      await applyMigration(client, filename, sql, hash, { dryRun });
    }
    console.log(JSON.stringify({ status: "completed", dry_run: dryRun, checked: files.length, pending }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`[DB MIGRATION ERROR] ${error.message}`);
  process.exit(1);
});
