import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/runtime');
const lockText = await readFile(resolve(root, 'runtime-lock.json'), 'utf8');
const lock = JSON.parse(lockText);
const digest = data => createHash('sha256').update(data).digest('hex');
const safePath = path => {
  const output = resolve(target, path);
  const rel = relative(target, output);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Unsafe runtime path: ${path}`);
  return output;
};

if (lock.schema_version !== 1 || !Array.isArray(lock.assets)) throw new Error('Unsupported runtime lock.');
await mkdir(target, { recursive: true });
let completed = 0;
async function provision(asset) {
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`Missing pin: ${asset.path}`);
  if (!asset.url.startsWith('https://')) throw new Error(`Runtime URL must use HTTPS: ${asset.path}`);
  const output = safePath(asset.path);
  await mkdir(dirname(output), { recursive: true });
  try {
    const existing = await readFile(output);
    if (digest(existing) === asset.sha256) { completed++; return; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download ${asset.path}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== asset.sha256) throw new Error(`Runtime integrity check failed: ${asset.path}`);
  const temporary = `${output}.part`;
  await writeFile(temporary, bytes);
  // Windows rename does not replace an existing file reliably.
  try { await unlink(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(temporary, output);
  completed++;
  console.log(`Runtime ${completed}/${lock.assets.length}: ${asset.path}`);
}
const queue = [...lock.assets];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) await provision(queue.shift());
}));

const adapter = await readFile(resolve(root, 'python/solver_adapter.py'));
await mkdir(resolve(target, 'app'), { recursive: true });
await copyFile(resolve(root, 'python/solver_adapter.py'), resolve(target, 'app/solver_adapter.py'));
const manifest = {
  schema_version: 1,
  pyodide_version: lock.pyodide_version,
  pandapower_version: lock.pandapower_version,
  package_lock_digest: digest(lockText),
  total_bytes: lock.assets.filter(a => a.kind !== 'notice').reduce((total, a) => total + a.bytes, 0),
  load_packages: lock.load_packages,
  wheels: lock.assets.filter(a => a.kind === 'pure-wheel').map(({ name, version, path, sha256, bytes }) => ({ name, version, path, sha256, bytes })),
  adapter: { path: 'app/solver_adapter.py', sha256: digest(adapter), bytes: adapter.length },
};
await writeFile(resolve(target, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
// Pyodide's Emscripten .js loader uses CommonJS under Node; browsers ignore this file.
await writeFile(resolve(target, 'package.json'), '{"type":"commonjs"}\n');

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const notices = spawnSync(python, [resolve(root, 'scripts/runtime-notices.py')], { cwd: root, encoding: 'utf8' });
if (notices.status !== 0) throw new Error(`Runtime notice generation failed: ${notices.stderr || notices.error}`);
console.log(`Self-hosted runtime ready: ${(manifest.total_bytes / 1_000_000).toFixed(2)} MB; ${lock.assets.length} verified assets.`);
