import { useCallback, useEffect, useRef, useState } from 'react';
import { attachSolution, confirmReview, parseStudyDocument } from './model';
import type { ResultNumber, StudyDocument } from './model';
import { BrowserSolverAdapter } from './solver/client';
import type { RuntimeInfo } from './solver/client';
import type { RuntimeProgress } from './solver/runtime.mjs';
import { compareWithReference } from './proof';
import type { NativeReference } from './proof';
import { rasterizeProofImage, runVisionProof } from './vision/api';
import type { VisionObservation } from './vision/api';

const base = import.meta.env.BASE_URL;
const asset = (path: string) => `${base}${path}`;
const value = (v?: ResultNumber, digits = 3) => v?.status === 'available'
  ? v.value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const input = <T,>(field: { status: 'known'; value: T } | { status: 'missing' } | undefined): T | null => field?.status === 'known' ? field.value : null;
const label = (document: StudyDocument, id: string) => input(document.elements.find(e => e.id === id)?.label) ?? id;
function saveFile(name: string, object: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [tab, setTab] = useState<'solver' | 'vision' | 'contract'>('solver');
  const [sample, setSample] = useState('case9');
  const [study, setStudy] = useState<StudyDocument | null>(null);
  const studyRef = useRef<StudyDocument | null>(null);
  const [reference, setReference] = useState<NativeReference | null>(null);
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState('');
  const [runtimeError, setRuntimeError] = useState('');
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [search, setSearch] = useState('');
  const [table, setTable] = useState<'buses' | 'branches' | 'sources'>('buses');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [events, setEvents] = useState<{ time: string; message: string }[]>([]);
  const [adapter] = useState(() => new BrowserSolverAdapter({ runtimeBaseURL: new URL(asset('runtime/'), location.origin).href }));
  const loadSequence = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  const log = useCallback((message: string) => setEvents(previous => [...previous.slice(-19), { time: new Date().toLocaleTimeString(), message }]), []);

  const initialize = useCallback(async () => {
    setInitializing(true); setRuntimeError('');
    try { const info = await adapter.initialize(setProgress); setRuntime(info); log(`Numerical engine ready · pandapower ${info.solverVersion}`); }
    catch (e) { setRuntimeError(e instanceof Error ? e.message : 'The numerical engine could not load.'); }
    finally { setInitializing(false); }
  }, [adapter, log]);
  useEffect(() => { void initialize(); return () => adapter.dispose(); }, [adapter, initialize]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (sample === 'imported') return;
    const sequence = ++loadSequence.current;
    adapter.invalidate(); setLoading(true); setError(''); setElapsed(null); setSolving(false); setStudy(null); studyRef.current = null;
    void Promise.all([fetch(asset(`fixtures/${sample}.json`)), fetch(asset(`fixtures/${sample}-reference.json`))])
      .then(async ([caseResponse, referenceResponse]) => {
        if (!caseResponse.ok || !referenceResponse.ok) throw new Error('The sample files could not load. Check the connection and retry.');
        const [caseText, native] = await Promise.all([caseResponse.text(), referenceResponse.json()]);
        // These immutable bundled cases are authored and checked by the fixture tests.
        // Imported files never take this automatic sample-review path.
        const document = await confirmReview(parseStudyDocument(caseText));
        if (sequence !== loadSequence.current) return;
        studyRef.current = document; setStudy(document); setReference(native as NativeReference);
        log(`Loaded ${input(document.meta.name)} · sample inputs from native pandapower`);
      }).catch(e => { if (sequence === loadSequence.current) setError(e instanceof Error ? e.message : 'Sample load failed.'); })
      .finally(() => { if (sequence === loadSequence.current) setLoading(false); });
  }, [sample, adapter, log]);

  const solve = async () => {
    if (!studyRef.current) return;
    const snapshot = studyRef.current;
    setSolving(true); setError(''); setElapsed(null);
    // A retained older result is immediately removed from the current display.
    const unsolved = { ...snapshot, solution: null }; studyRef.current = unsolved; setStudy(unsolved);
    const start = performance.now();
    try {
      const run = await adapter.solve(unsolved);
      if (studyRef.current !== unsolved) return;
      const next = await attachSolution(unsolved, run);
      if (studyRef.current !== unsolved) return;
      studyRef.current = next; setStudy(next); setElapsed(performance.now() - start);
      log(run.status === 'converged' ? `Converged · ${run.iterations ?? 'unreported'} iterations · revision ${run.model_revision}` : `Solve ${run.status} · inspect diagnostics`);
    } catch (e) {
      if (studyRef.current === unsolved) { setError(e instanceof Error ? e.message : 'The solve failed.'); log('Solve did not complete. No result was accepted.'); }
    } finally { setSolving(false); }
  };
  const importCase = async (file?: File) => {
    if (!file) return;
    ++loadSequence.current; adapter.invalidate(); setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('The canonical JSON limit is 10 MB.');
      const document = parseStudyDocument(await file.text());
      document.solution = null;
      document.review = { ...document.review, status: 'pending', confirmed_model_revision: null, confirmed_input_hash: null, confirmed_at: null };
      setSample('imported'); setReference(null); studyRef.current = document; setStudy(document); setElapsed(null);
      log('Imported canonical case · inspect and confirm the exact inputs before solving');
    } catch (e) { setError(e instanceof Error ? e.message : 'The file could not be imported.'); }
    finally { setLoading(false); }
  };
  const reviewCurrent = async () => {
    const current = studyRef.current;
    if (!current) return;
    const reviewed = await confirmReview(current);
    if (studyRef.current !== current) return;
    studyRef.current = reviewed; setStudy(reviewed); setError('');
    log('User confirmed the inspected canonical inputs and their exact fingerprint');
  };
  const run = study?.solution;
  const results = run?.status === 'converged' ? run.results : null;
  const proof = run && reference ? compareWithReference(run, reference) : null;
  const buses = results?.buses.filter(b => !search || b.busbar_ids.some(id => `${id} ${study ? label(study, id) : ''}`.toLowerCase().includes(search.toLowerCase()))) ?? [];
  const branches = results ? [...results.lines.map(l => ({ id: l.element_id, kind: 'Line', p: l.p_from_mw, q: l.q_from_mvar, current: l.i_from_ka, loading: l.loading_percent, loss: l.p_loss_mw })), ...results.transformers.map(t => ({ id: t.element_id, kind: 'Transformer', p: t.p_hv_mw, q: t.q_hv_mvar, current: t.i_hv_ka, loading: t.loading_percent, loss: t.p_loss_mw }))].filter(b => !search || `${b.id} ${study ? label(study, b.id) : ''}`.toLowerCase().includes(search.toLowerCase())) : [];

  return <div className="app">
    <header className="topbar">
      <a href="#" className="brand" aria-label="SLD Power Flow home"><span className="brand-icon">⌁</span><span>SLD <strong>Power Flow</strong></span></a>
      <span className="version">PHASE 01 / FOUNDATIONS</span>
      <div className="top-actions"><span className="study-badge">◇ STUDY MODE</span><button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☼' : '◐'}</button><a className="github-link" href="https://github.com/divyanshchaudhary85/sld-power-flow" target="_blank" rel="noreferrer">Source ↗</a></div>
    </header>
    <div className="desktop-note">This study workspace is designed for a desktop browser at least 1280 px wide.</div>
    <div className="layout">
      <aside className="sidebar">
        <div className="section-label">WORKSPACE</div>
        <nav aria-label="Workspace"><button className={tab === 'solver' ? 'nav active' : 'nav'} onClick={() => setTab('solver')}><span>⌘</span> Solver verification</button><button className={tab === 'vision' ? 'nav active' : 'nav'} onClick={() => setTab('vision')}><span>▧</span> Vision connection</button><button className={tab === 'contract' ? 'nav active' : 'nav'} onClick={() => setTab('contract')}><span>⊞</span> Case contract</button></nav>
        <div className="section-label samples-label">REFERENCE CASES <span>02</span></div>
        <button className={sample === 'case9' ? 'case active-case' : 'case'} onClick={() => { setSample('case9'); setTab('solver'); }}><span className="case-number">09</span><span><strong>IEEE 9-bus</strong><small>Transmission · sample</small></span></button>
        <button className={sample === 'case14' ? 'case active-case' : 'case'} onClick={() => { setSample('case14'); setTab('solver'); }}><span className="case-number">14</span><span><strong>IEEE 14-bus</strong><small>Transmission · sample</small></span></button>
        <button className="load-case" onClick={() => upload.current?.click()}>＋ Open canonical JSON</button><input ref={upload} type="file" accept=".json,application/json" hidden onChange={e => { void importCase(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="sidebar-bottom"><span className="section-label">BUILT FOR TRACEABILITY</span><p>Inputs have provenance.<br />Results come from the solver.</p><div className="local-indicator">◉ Files stay in this browser</div><small>Only the optional vision test sends its synthetic tile to OpenAI.</small></div>
      </aside>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{tab === 'solver' ? 'NUMERICAL FOUNDATION' : tab === 'vision' ? 'PROVIDER FOUNDATION' : 'DATA FOUNDATION'}</div><h1>{tab === 'solver' ? 'Prove the engine. Trust the study.' : tab === 'vision' ? 'Test the vision connection.' : 'One case. Every source accounted for.'}</h1><p>{tab === 'solver' ? 'Solve a known network in your browser and compare every bus with native pandapower.' : tab === 'vision' ? 'One synthetic tile, your API key, and a schema-validated response.' : 'Inspect and save the same versioned document used by the numerical engine.'}</p></div><span className="phase-pill">Phase 1 proof workspace</span></div>
        <div className="scope-note"><span>ⓘ</span><span>Balanced, positive-sequence study only. Upload extraction, engineering validation, switching and full exports arrive in later phases. This workspace never controls equipment.</span></div>
        {error && <div role="alert" className="error-box"><strong>Study not completed</strong><p>{error}</p></div>}
        {tab === 'solver' && <>
          <div className="case-toolbar"><div><span className="sample-badge">{sample === 'imported' ? 'LOCAL CASE' : 'SAMPLE'}</span><h2>{study ? input(study.meta.name) : 'Loading case…'}</h2><span className="subtle">{study ? `${input(study.meta.frequency_hz)} Hz · ${input(study.meta.base_mva)} MVA base · rev ${study.revision}` : ''}</span></div><div className="button-row"><button disabled={!study} onClick={() => study && saveFile(`${sample}.json`, study)}>Save case</button><button className="primary" disabled={!study || study.review.status !== 'confirmed' || loading || solving || initializing || !runtime} onClick={() => void solve()}>{study?.review.status === 'pending' ? 'Review required' : solving ? 'Solving…' : initializing ? 'Engine loading…' : '▶ Solve in browser'}</button>{solving && <button onClick={() => { adapter.cancel(); setRuntime(null); setSolving(false); setError('Solve cancelled. Reload the engine before trying again.'); }}>Cancel</button>}</div></div>
          {study?.review.status === 'pending' && <div className="scope-note"><span>This imported case needs your input review.</span><button onClick={() => setTab('contract')}>Inspect and confirm case</button></div>}<div className="metrics"><Metric title="SOLVE STATUS" text={solving ? 'Solving' : run?.status === 'converged' ? 'Converged' : run ? run.status : 'Not solved'} unit={run?.iterations != null ? `${run.iterations} iterations` : 'Newton–Raphson AC'} /><Metric title="GENERATION" text={value(results?.system.total_generation_mw)} unit="MW" /><Metric title="SERVED LOAD" text={value(results?.system.total_served_load_mw)} unit="MW" /><Metric title="ACTIVE LOSSES" text={value(results?.system.total_loss_mw)} unit="MW" /></div>
          <div className="work-grid"><section className="panel results-panel"><div className="panel-header"><h3>Network results</h3><span className="subtle">{results ? 'Calculated in this browser' : 'Waiting for a solve'}</span></div><div className="table-toolbar"><div className="tabs" role="tablist" aria-label="Result tables">{(['buses', 'branches', 'sources'] as const).map(t => <button role="tab" aria-selected={table === t} className={table === t ? 'selected' : ''} key={t} onClick={() => setTable(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div><input className="search" placeholder="Filter by ID or label" aria-label="Filter results" value={search} onChange={e => setSearch(e.target.value)} /></div>
            {!results ? <div className="empty-state"><div className="empty-symbol">⌁</div><h3>{loading ? 'Loading reference inputs' : solving ? 'Solving the network' : 'Ready for a real calculation'}</h3><p>{solving ? 'The Python worker is computing the AC power flow.' : 'Run the solver to see voltages, power flows and losses. No reference answers are displayed as live results.'}</p>{study && <div className="input-summary"><span>{study.elements.filter(e => e.type.value === 'busbar').length} buses</span><span>{study.elements.filter(e => ['line', 'cable', 'transformer_2w'].includes(e.type.value)).length} branches</span><span>All sample inputs traceable</span></div>}</div> : <div className="table-scroll">
              {table === 'buses' && <table><thead><tr><th>Bus</th><th>Voltage · kV</th><th>Voltage · pu</th><th>Angle · °</th><th>Net P · MW</th><th>Net Q · MVAr</th></tr></thead><tbody>{buses.map(b => <tr key={b.solver_bus_id}><td className="row-label">{study ? label(study, b.busbar_ids[0]) : b.busbar_ids[0]}</td><td>{value(b.voltage_kv)}</td><td>{value(b.voltage_pu, 6)}</td><td>{value(b.angle_degree)}</td><td>{value(b.net_p_mw)}</td><td>{value(b.net_q_mvar)}</td></tr>)}</tbody></table>}
              {table === 'branches' && <table><thead><tr><th>Element</th><th>Type</th><th>P from · MW</th><th>Q from · MVAr</th><th>I from · kA</th><th>Loading · %</th><th>Loss · MW</th></tr></thead><tbody>{branches.map(b => <tr key={b.id}><td className="row-label">{study ? label(study, b.id) : b.id}</td><td>{b.kind}</td><td>{value(b.p)}</td><td>{value(b.q)}</td><td>{value(b.current)}</td><td>{value(b.loading, 1)}</td><td>{value(b.loss)}</td></tr>)}</tbody></table>}
              {table === 'sources' && <table><thead><tr><th>Source</th><th>P · MW</th><th>Q · MVAr</th><th>Voltage · kV</th></tr></thead><tbody>{[...results.external_grids, ...results.generators].filter(g => !search || `${g.element_id} ${study ? label(study, g.element_id) : ''}`.toLowerCase().includes(search.toLowerCase())).map(g => <tr key={g.element_id}><td className="row-label">{study ? label(study, g.element_id) : g.element_id}</td><td>{value(g.p_mw)}</td><td>{value(g.q_mvar)}</td><td>{value(g.voltage_kv)}</td></tr>)}</tbody></table>}
            </div>}
            <div className="table-foot">{table === 'buses' ? 'Net power: positive injection into the network.' : table === 'branches' ? 'Branch power: positive from the bus into the element; HV end for transformers.' : 'Source power: positive generation into the network.'}<span>{elapsed !== null ? `${(elapsed / 1000).toFixed(3)} s request-to-result` : 'Full precision retained'}</span></div>
          </section><aside className="verification-column"><section className="panel"><div className="panel-header"><h3>Reference check</h3><span className={proof && !proof.passed ? 'status failed' : 'status'}>{proof ? proof.passed ? '✓ Pass' : '△ Failed' : '○ Pending'}</span></div><div className="proof-body"><span className="section-label">MAXIMUM BUS VOLTAGE DIFFERENCE</span><div className="proof-number">{proof?.maxError != null ? proof.maxError.toExponential(2) : '—'} <small>pu</small></div><div className="criterion"><span>Acceptance threshold</span><strong>≤ 1 × 10⁻⁶ pu</strong></div><p>{reference ? `Against an independently executed native pandapower ${reference.pandapower_version} solve. All ${reference.buses.length} reference buses must match.` : 'Imported cases do not have a bundled reference answer.'}</p>{proof && <details><summary>Compare every bus</summary><table className="comparison"><thead><tr><th>Bus</th><th>|ΔV| · pu</th></tr></thead><tbody>{proof.rows.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.error === null ? 'Unavailable' : r.error.toExponential(3)}</td></tr>)}</tbody></table></details>}</div></section>
            <section className="panel runtime-panel"><div className="panel-header"><h3>Numerical engine</h3><span className="status">{runtime ? '✓ Ready' : '○ Loading'}</span></div><dl><dt>Solver</dt><dd>pandapower {runtime?.solverVersion ?? '3.3.3'}</dd><dt>Runtime</dt><dd>Pyodide {runtime?.runtimeVersion ?? '0.29.3'}</dd><dt>Execution</dt><dd>Local Web Worker</dd><dt>Download source</dt><dd>This site</dd>{runtime && <><dt>Initialization</dt><dd>{(runtime.loadMs / 1000).toFixed(2)} s</dd></>}</dl>{initializing && <div className="progress-region" role="status"><progress value={progress?.completed} max={progress?.total ?? 1} /><p>{progress?.message ?? 'Preparing the numerical runtime…'}</p></div>}{runtimeError && <div className="runtime-error" role="alert">{runtimeError}</div>}{!runtime && !initializing && <button onClick={() => void initialize()}>Reload engine</button>}<p className="small-note">Initial loading is measured separately from a warm solve. The 50-bus redraw target is tested in Phase 3.</p></section>
          </aside></div>
          {!!run?.diagnostics.length && <section className="panel diagnostics"><h3>Solver diagnostics</h3>{run.diagnostics.map(d => <p key={d.id}><strong>{d.severity}</strong> · {d.message}</p>)}</section>}
          <section className="event-log panel"><div className="panel-header"><h3>Session events</h3><span className="subtle">Local session only</span></div>{events.length ? events.slice().reverse().map((event, i) => <div className="event-row" key={`${event.time}-${i}`}><time>{event.time}</time><span>{event.message}</span></div>) : <div className="event-row">No events yet.</div>}</section>
        </>}
        {tab === 'vision' && <VisionPanel />}
        {tab === 'contract' && <section className="panel contract"><div className="panel-header"><h3>Canonical study document</h3><button disabled={!study} onClick={() => study && saveFile(`${sample}.json`, study)}>Download JSON</button></div><div className="contract-intro"><p>Schema version <strong>{study?.schema_version ?? '1.0.0'}</strong>. Explicit switching devices, source evidence and provenance stay in the model. A missing input is never replaced silently.</p><p>This phase checks the document structure and references. The complete engineering rule catalog is Phase 2.</p>{study?.review.status === 'pending' && <p><button className="primary" onClick={() => void reviewCurrent()}>I inspected these inputs — confirm case</button></p>}<a href={asset('schema/study-document.schema.json')} target="_blank" rel="noreferrer">View JSON Schema ↗</a></div><pre>{study ? JSON.stringify(study, null, 2) : 'Load a case to inspect its contract.'}</pre></section>}
        <footer className="page-footer"><span>SIMULATED STUDIES ONLY</span><span>No analytics · No server-side case storage · No shipped API key</span></footer>
      </main>
    </div>
  </div>;
}

function Metric({ title, text, unit }: { title: string; text: string; unit: string }) {
  return <div className="metric"><span className="section-label">{title}</span><strong>{text}</strong><small>{unit}</small></div>;
}

function VisionPanel() {
  const [key, setKey] = useState(''); const [model, setModel] = useState('');
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [result, setResult] = useState<VisionObservation | null>(null);
  const [receipt, setReceipt] = useState<{ origin: string; at: string; model: string; requestId: string | null } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async () => {
    controller.current = new AbortController(); setBusy(true); setError(''); setResult(null); setReceipt(null);
    try {
      const image = await rasterizeProofImage(asset('synthetic-proof.svg'));
      const response = await runVisionProof(key, model, image, controller.current.signal);
      setResult(response.observation); setReceipt({ origin: location.origin, at: new Date().toISOString(), model: model.trim(), requestId: response.requestId });
    } catch (e) { setError(e instanceof Error ? e.message : 'The test failed.'); }
    finally { setBusy(false); }
  };
  return <div className="vision-grid"><section className="panel"><div className="panel-header"><h3>01 / Synthetic drawing</h3><span className="sample-badge">SAMPLE</span></div><img className="synthetic" src={asset('synthetic-proof.svg')} alt="Synthetic diagram with two labeled busbars, a line and a load. No engineering case data." /><div className="contract-intro"><h3>Only perception. No electrical answers.</h3><p>The model reports visible symbols, labels, source boxes and confidence. A valid response proves this browser can make a structured image request; it does not establish extraction accuracy.</p></div></section><section className="panel vision-form"><div className="panel-header"><h3>02 / Direct browser request</h3><span className="status">{result ? '✓ Response validated' : '○ Not proven'}</span></div><div className="form-body"><p>Your key is held in memory for this panel only. It is sent directly to <strong>api.openai.com</strong>, never saved to files or browser storage.</p><label>OpenAI API key<input type="password" value={key} autoComplete="off" spellCheck={false} onChange={e => setKey(e.target.value)} placeholder="Enter your own API key" /></label><label>Vision-capable model ID<input value={model} autoComplete="off" spellCheck={false} onChange={e => setModel(e.target.value)} placeholder="Enter a model available to your account" /></label><a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noreferrer">Check model capabilities ↗</a><label className="checkbox"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>Send this synthetic tile to OpenAI using my account. API charges and the provider’s data policy apply.</span></label><p className="small-note">The request uses store:false. This is not a promise of zero provider retention. <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">Data policy ↗</a></p><div className="button-row"><button className="primary" disabled={!key.trim() || !model.trim() || !consent || busy} onClick={() => void submit()}>{busy ? 'Request in progress…' : 'Send 1 synthetic tile ↗'}</button><button onClick={() => { controller.current?.abort(); setKey(''); }} disabled={!key}>Clear key</button>{busy && <button onClick={() => controller.current?.abort()}>Cancel</button>}</div>{error && <div className="error-box" role="alert">{error}</div>}{result && <div className="vision-success" role="status"><h3>Schema-valid image response</h3><p>{result.components.length} observed components · {receipt?.model}</p><p className="small-note">Origin: {receipt?.origin}<br />{receipt?.at}</p><button onClick={() => saveFile('vision-proof.json', { receipt, result })}>Save proof receipt</button><details open><summary>Inspect the actual response</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}</div></section></div>;
}
