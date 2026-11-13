import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'public/schema'), { recursive: true });
await copyFile(resolve(root, 'schema/study-document.schema.json'), resolve(root, 'public/schema/study-document.schema.json'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const dependencies = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || !pkg.version) continue;
  const name = path.split('node_modules/').at(-1);
  dependencies.push({ name, version: pkg.version, license: pkg.license ?? 'See upstream distribution notice', development: !!pkg.dev, integrity: pkg.integrity ?? null });
}
await mkdir(resolve(root, 'public/notices'), { recursive: true });
await writeFile(resolve(root, 'public/notices/dependencies.json'), JSON.stringify({
  application: 'MIT',
  font: { name: 'Inter', version: '4.1', license: 'OFL-1.1', notice: 'Inter-LICENSE.txt', sha256: '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3' },
  javascript: dependencies,
  numerical_runtime: '../runtime/runtime-manifest.json',
}, null, 2) + '\n');
console.log(`Prepared canonical schema and ${dependencies.length} package licence records.`);
