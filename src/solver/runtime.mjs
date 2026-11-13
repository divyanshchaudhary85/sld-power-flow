/** The same runtime bootstrap is exercised in the browser Worker and Node proof. */
export async function initializeRuntime({ indexURL, manifest, loadPyodide, readBytes, onProgress = () => {} }) {
  if (manifest.schema_version !== 1) throw new Error('Unsupported solver runtime manifest.');
  const started = performance.now();
  onProgress({ stage: 'loading-python', message: 'Loading self-hosted Python / WebAssembly…' });
  const pyodide = await loadPyodide({
    indexURL,
    packageBaseUrl: indexURL,
    lockFileURL: `${indexURL}pyodide-lock.json`,
    fullStdLib: false,
    stdout: () => {},
    stderr: () => {},
  });
  if (pyodide.version !== manifest.pyodide_version) throw new Error('The Python runtime version differs from the pinned manifest.');
  onProgress({ stage: 'loading-packages', message: 'Loading numerical libraries…' });
  await pyodide.loadPackage(manifest.load_packages, {
    messageCallback: message => onProgress({ stage: 'loading-packages', message }),
    errorCallback: message => onProgress({ stage: 'loading-packages', message }),
    checkIntegrity: true,
  });
  const sitePackages = pyodide.runPython("import site; site.getsitepackages()[0]");
  for (let index = 0; index < manifest.wheels.length; index++) {
    const wheel = manifest.wheels[index];
    onProgress({ stage: 'installing-wheels', message: `Installing ${wheel.name} ${wheel.version}`, completed: index, total: manifest.wheels.length });
    const bytes = await readBytes(wheel.path);
    await verifyDigest(bytes, wheel.sha256, wheel.path);
    pyodide.unpackArchive(bytes, 'wheel', { extractDir: sitePackages });
  }
  // Validate the complete declared dependency closure without any package-index requests.
  pyodide.globals.set('_sld_expected_versions_json', JSON.stringify(Object.fromEntries(manifest.wheels.map(w => [w.name, w.version]))));
  pyodide.runPython(`
import importlib, importlib.metadata, json
from packaging.requirements import Requirement
from packaging.version import Version
importlib.invalidate_caches()
_sld_expected = json.loads(_sld_expected_versions_json)
for _name, _version in _sld_expected.items():
    if importlib.metadata.version(_name) != _version:
        raise RuntimeError(f"Incorrect runtime package version: {_name}")
    for _requirement in importlib.metadata.requires(_name) or []:
        _req = Requirement(_requirement)
        if _req.marker is not None and not _req.marker.evaluate({'extra': ''}):
            continue
        _actual = importlib.metadata.version(_req.name)
        if _req.specifier and Version(_actual) not in _req.specifier:
            raise RuntimeError(f"Unsatisfied runtime dependency: {_name}: {_req} (installed {_actual})")
`);
  pyodide.globals.delete('_sld_expected_versions_json');
  onProgress({ stage: 'loading-adapter', message: 'Loading and checking the pandapower adapter…' });
  const adapter = await readBytes(manifest.adapter.path);
  await verifyDigest(adapter, manifest.adapter.sha256, manifest.adapter.path);
  pyodide.FS.mkdirTree('/app');
  pyodide.FS.writeFile('/app/solver_adapter.py', adapter);
  pyodide.runPython("import sys; sys.path.insert(0, '/app'); from solver_adapter import solve_document; import pandapower");
  const installedVersion = pyodide.runPython('pandapower.__version__');
  if (installedVersion !== manifest.pandapower_version) throw new Error('The solver version differs from the pinned manifest.');
  const loadMs = performance.now() - started;
  onProgress({ stage: 'ready', message: `pandapower ${installedVersion} is ready.`, loadMs });
  return { pyodide, manifest, loadMs };
}

export async function verifyDigest(bytes, expected, label) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error(`Solver asset integrity check failed: ${label}`);
}

export function solveRuntime(runtime, document, inputHash = '') {
  const { pyodide, manifest } = runtime;
  pyodide.globals.set('_sld_document_json', JSON.stringify(document));
  pyodide.globals.set('_sld_runtime_version', manifest.pyodide_version);
  pyodide.globals.set('_sld_lock_digest', manifest.package_lock_digest);
  pyodide.globals.set('_sld_input_hash', inputHash);
  try {
    const json = pyodide.runPython(`json.dumps(solve_document(json.loads(_sld_document_json), _sld_input_hash or None, runtime='pyodide', runtime_version=_sld_runtime_version, package_lock_digest=_sld_lock_digest), allow_nan=False)`);
    return JSON.parse(json);
  } finally {
    pyodide.globals.delete('_sld_document_json');
    pyodide.globals.delete('_sld_runtime_version');
    pyodide.globals.delete('_sld_lock_digest');
    pyodide.globals.delete('_sld_input_hash');
  }
}
