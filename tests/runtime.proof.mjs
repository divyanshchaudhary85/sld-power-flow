/** Real Pyodide/pandapower proof. No stubs. Run after provision:runtime and native fixtures. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diagnoseRuntime, exportRuntime, initializeRuntime, solveRuntime } from '../src/solver/runtime.mjs';

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
  const results = [], exports = [], diagnostics = [];
  const outputPath = resolve(root, 'test-results/runtime-exports');
  await mkdir(outputPath, { recursive: true });
  for (const fixture of ['case9', 'case14', 'case50', 'case9-breaker']) {
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
    if (fixture !== 'case9' && fixture !== 'case14') continue;
    const findings = diagnoseRuntime(runtime, document);
    assert.ok(Array.isArray(findings));
    assert.ok(findings.every(finding => finding.model_revision === document.revision && !finding.blocks_solve && finding.rule_id !== 'NATIVE_DIAGNOSTIC_ERROR'), `${fixture} native diagnostics failed.`);
    const invalidReview = structuredClone(document); invalidReview.review.status = 'pending';
    assert.ok(diagnoseRuntime(runtime, invalidReview).some(finding => finding.rule_id === 'NATIVE_MODEL_PRECONDITION' && finding.blocks_solve));
    diagnostics.push({ fixture, finding_count: findings.length, no_native_errors: true, invalid_review_blocked: true });
    console.log(`${fixture}: native diagnostics and invalid-review gate passed`);
    const nativeVoltages = new Map(actual.results.buses.map(bus => [Number(bus.solver_bus_id.split(':')[1]), bus.voltage_pu.value]));
    for (const format of ['pandapower-json', 'matpower', 'psse-raw']) {
      const exportStarted = performance.now(), exported = exportRuntime(runtime, document, format, actual.input_hash);
      assert.equal(exported.format, format); assert.equal(exported.model_revision, document.revision);
      assert.equal(exported.input_hash, actual.input_hash); assert.ok(exported.warnings.length > 0); assert.equal(exported.bus_map.length, reference.size);
      const bytes = Buffer.from(exported.data, exported.encoding === 'base64' ? 'base64' : 'utf8');
      const extension = { 'pandapower-json': 'json', matpower: 'mat', 'psse-raw': 'raw' }[format];
      await writeFile(resolve(outputPath, `${fixture}.${extension}`), bytes);
      await writeFile(resolve(outputPath, `${fixture}-${extension}-bus-map.json`), JSON.stringify(exported.bus_map));
      let roundtripError = null, verification;
      if (format === 'psse-raw') {
        assert.match(exported.data.split('\n')[0], /^0,\s*100(?:\.0+)?,\s*33,/);
        assert.ok(exported.data.includes('END OF BUS DATA')); assert.ok(exported.data.includes('END OF TRANSFORMER DATA'));
        assert.ok(exported.data.trim().endsWith('Q')); assert.ok(!/\b(?:nan|inf|undefined)\b/i.test(exported.data));
        verification = 'Generated by actual Pyodide exporter; v33 framing/finite values checked. Independent native RAW parser is a separate proof.';
      } else {
        runtime.pyodide.globals.set('_proof_export', JSON.stringify(exported));
        runtime.pyodide.globals.set('_proof_frequency', document.meta.frequency_hz.value);
        let imported;
        try {
          imported = JSON.parse(runtime.pyodide.runPython(`
import base64, pathlib
import pandapower as pp
from pandapower.converter.matpower.from_mpc import from_mpc
_proof_payload = json.loads(_proof_export)
if _proof_payload['format'] == 'pandapower-json':
    _proof_net = pp.from_json_string(_proof_payload['data'])
    _proof_model = 't'
else:
    pathlib.Path('/tmp/proof.mat').write_bytes(base64.b64decode(_proof_payload['data']))
    _proof_net = from_mpc('/tmp/proof.mat', f_hz=_proof_frequency)
    _proof_model = 'pi'
pp.runpp(_proof_net, numba=False, calculate_voltage_angles=True, tolerance_mva=1e-8, max_iteration=30, trafo_model=_proof_model)
json.dumps({'converged': bool(_proof_net.converged), 'buses': {str(m['native_bus']): float(_proof_net.res_bus.at[m['export_bus'] - int(_proof_payload['format'] == 'matpower'), 'vm_pu']) for m in _proof_payload['bus_map']}}, allow_nan=False)
`));
        } finally { runtime.pyodide.globals.delete('_proof_export'); runtime.pyodide.globals.delete('_proof_frequency'); }
        assert.equal(imported.converged, true); roundtripError = 0;
        for (const [nativeBus, voltage] of Object.entries(imported.buses)) {
          assert.ok(nativeVoltages.has(Number(nativeBus)));
          roundtripError = Math.max(roundtripError, Math.abs(voltage - nativeVoltages.get(Number(nativeBus))));
        }
        assert.ok(roundtripError < 1e-4, `${fixture}/${format} export roundtrip error ${roundtripError} pu.`);
        verification = 'Reimported and solved inside actual Pyodide using pandapower converter.';
      }
      exports.push({ fixture, format, bytes: bytes.length, maximum_voltage_error_pu: roundtripError, elapsed_ms: performance.now() - exportStarted, verification });
      console.log(`${fixture}/${format}: ${bytes.length} bytes; roundtrip voltage error ${roundtripError ?? 'separate RAW proof'} pu`);
    }
  }
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(resolve(root, 'test-results/runtime-proof.json'), JSON.stringify({
    environment: 'Node Pyodide (browser deployment proof is separate)', timestamp: new Date().toISOString(),
    pyodide: manifest.pyodide_version, pandapower: manifest.pandapower_version,
    package_lock_digest: manifest.package_lock_digest, adapter_sha256: manifest.adapter.sha256, exporter_sha256: manifest.exporter.sha256,
    network_requests: 0, load_ms: runtime.loadMs, results, exports, diagnostics,
  }, null, 2) + '\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
