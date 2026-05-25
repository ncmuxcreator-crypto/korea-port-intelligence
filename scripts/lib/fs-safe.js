import fs from 'fs/promises';
import path from 'path';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function writeText(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, data, 'utf8');
}
