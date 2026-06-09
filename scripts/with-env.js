import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const ROOT = process.cwd();
const ENV_FILES = [
  ".env.local",
  ".env",
  path.join("..", "hwkport-push", ".env.local"),
  path.join("..", "hwkport-push", ".env")
];

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

const target = process.argv[2];
if (!target) {
  console.error("[with-env] target script is required");
  process.exit(1);
}

await import(pathToFileURL(path.resolve(ROOT, target)));
