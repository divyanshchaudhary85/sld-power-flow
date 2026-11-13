/** Real Pyodide/pandapower proof. No stubs. Run after provision:runtime and native fixtures. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeRuntime, solveRuntime } from '../src/solver/runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = resolve(root, 'public/runtime');
const manifest = JSON.parse(await readFile(resolve(runtimePath, 'runtime-manifest.json'), 'utf8'));
const { loadPyodide } = await import(pathToFileURL(resolve(runtimePath, 'pyodide.mjs')).href);
// A successful proof must never silently fall back to fetching Python packages online.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the self-hosted runtime proof.'); };
try {
  const runtime = await initializeRuntime({
    indexURL: runtimePath.replaceAll('\\', '/') + '/', manifest, loadPyodide,
    readBytes: async path => new Uint8Array(await readFile(resolve(runtimePath, path))),
    onProgress: ({ message }) => console.log(message),
  });
  const results = [];
  for (const fixture of ['case9', 'case14']) {
    const document = JSON.parse(await readFile(resolve(root, `public/fixtures/${fixture}.json`), 'utf8'));
    const baseline = JSON.parse(await readFile(resolve(root, `public/fixtures/${fixture}-reference.json`), 'utf8'));
    const started = performance.now();
    const actual = solveRuntime(runtime, document);
    assert.equal(actual.status, 'converged', `${fixture} did not converge in Pyodide.`);
    assert.equal(actual.model_revision, document.revision);
    const reference = new Map(baseline.buses.map(row => [row.busbar_id, row]));
    let maxError = 0;
    for (const bus of actual.results.buses) {
      for (const id of bus.busbar_ids) {
        const expected = reference.get(id);
        assert.ok(expected, `Unknown result bus: ${id}`);
        assert.equal(bus.voltage_pu.status, 'available');
        const error = Math.abs(bus.voltage_pu.value - expected.voltage_pu);
        maxError = Math.max(maxError, error);
        assert.ok(error <= 1e-6, `${fixture}/${id}: ${error} pu exceeds 1e-6.`);
      }
    }
    assert.equal(actual.results.buses.length, reference.size);
    results.push({ fixture, status: actual.status, buses: actual.results.buses.length, maximum_voltage_error_pu: maxError,
      elapsed_ms: performance.now() - started, input_hash: actual.input_hash });
    console.log(`${fixture}: converged; max voltage error ${maxError} pu`);
  }
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(resolve(root, 'test-results/runtime-proof.json'), JSON.stringify({
    environment: 'Node Pyodide (browser deployment proof is separate)', timestamp: new Date().toISOString(),
    pyodide: manifest.pyodide_version, pandapower: manifest.pandapower_version,
    package_lock_digest: manifest.package_lock_digest, network_requests: 0, load_ms: runtime.loadMs, results,
  }, null, 2) + '\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
