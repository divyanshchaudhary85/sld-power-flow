import { useState, useRef, useEffect } from "react";
import { rasterizeProofImage, runVisionProof } from "../vision/api";
import type { VisionObservation } from "../vision/api";
import { download } from "./values";
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const saveFile = (name: string, object: unknown) =>
  download(name, JSON.stringify(object, null, 2));
export default function VisionProof() {
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VisionObservation | null>(null);
  const [receipt, setReceipt] = useState<{
    origin: string;
    at: string;
    model: string;
    requestId: string | null;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async () => {
    controller.current = new AbortController();
    setBusy(true);
    setError("");
    setResult(null);
    setReceipt(null);
    try {
      const image = await rasterizeProofImage(asset("synthetic-proof.svg"));
      const response = await runVisionProof(
        key,
        model,
        image,
        controller.current.signal,
      );
      setResult(response.observation);
      setReceipt({
        origin: location.origin,
        at: new Date().toISOString(),
        model: model.trim(),
        requestId: response.requestId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The test failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vision-grid">
      <section className="panel">
        <div className="panel-header">
          <h3>01 / Synthetic drawing</h3>
          <span className="sample-badge">SAMPLE</span>
        </div>
        <img
          className="synthetic"
          src={asset("synthetic-proof.svg")}
          alt="Synthetic diagram with two labeled busbars, a line and a load. No engineering case data."
        />
        <div className="contract-intro">
          <h3>Only perception. No electrical answers.</h3>
          <p>
            The model reports visible symbols, labels, source boxes and
            confidence. A valid response proves this browser can make a
            structured image request; it does not establish extraction accuracy.
          </p>
        </div>
      </section>
      <section className="panel vision-form">
        <div className="panel-header">
          <h3>02 / Direct browser request</h3>
          <span className="status">
            {result ? "✓ Response validated" : "○ Not proven"}
          </span>
        </div>
        <div className="form-body">
          <p>
            Your key is held in memory for this panel only. It is sent directly
            to <strong>api.openai.com</strong>, never saved to files or browser
            storage.
          </p>
          <label>
            OpenAI API key
            <input
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter your own API key"
            />
          </label>
          <label>
            Vision-capable model ID
            <input
              value={model}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Enter a model available to your account"
            />
          </label>
          <a
            href="https://developers.openai.com/api/docs/models"
            target="_blank"
            rel="noreferrer"
          >
            Check model capabilities ↗
          </a>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Send this synthetic tile to OpenAI using my account. API charges
              and the provider’s data policy apply.
            </span>
          </label>
          <p className="small-note">
            The request uses store:false. This is not a promise of zero provider
            retention.{" "}
            <a
              href="https://developers.openai.com/api/docs/guides/your-data"
              target="_blank"
              rel="noreferrer"
            >
              Data policy ↗
            </a>
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={!key.trim() || !model.trim() || !consent || busy}
              onClick={() => void submit()}
            >
              {busy ? "Request in progress…" : "Send 1 synthetic tile ↗"}
            </button>
            <button
              onClick={() => {
                controller.current?.abort();
                setKey("");
              }}
              disabled={!key}
            >
              Clear key
            </button>
            {busy && (
              <button onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {result && (
            <div className="vision-success" role="status">
              <h3>Schema-valid image response</h3>
              <p>
                {result.components.length} observed components ·{" "}
                {receipt?.model}
              </p>
              <p className="small-note">
                Origin: {receipt?.origin}
                <br />
                {receipt?.at}
              </p>
              <button
                onClick={() =>
                  saveFile("vision-proof.json", { receipt, result })
                }
              >
                Save proof receipt
              </button>
              <details open>
                <summary>Inspect the actual response</summary>
                <pre>{JSON.stringify(result, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
