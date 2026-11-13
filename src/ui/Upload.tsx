import { useEffect, useRef, useState } from "react";
import type { StudyDocument } from "../model";
import { ingestFile } from "../ingestion";
import type { IngestedDocument } from "../ingestion";
import { extractDocument } from "../extraction/pipeline";
import { createOpenAIVisionAdapter } from "../extraction/provider";
import { createDraft, type DraftOptions } from "../extraction/model";
import { storeBlob } from "../storage";
export default function Upload({
  onComplete,
  onError,
}: {
  onComplete: (doc: StudyDocument) => void;
  onError: (message: string) => void;
}) {
  const [input, setInput] = useState<IngestedDocument | null>(null);
  const [stage, setStage] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [consent, setConsent] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [budget, setBudget] = useState(60);
  const [rotation, setRotation] = useState(0);
  const [network, setNetwork] = useState<DraftOptions["networkType"]>();
  const [frequency, setFrequency] = useState<50 | 60>();
  const [symbols, setSymbols] = useState<"IEC" | "ANSI_IEEE">("IEC");
  const [preview, setPreview] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!input?.pages[0]) return;
    const url = URL.createObjectURL(input.pages[0].raster);
    setTimeout(() => setPreview(url), 0);
    return () => URL.revokeObjectURL(url);
  }, [input]);
  const settings: DraftOptions = {
    caseName: input?.sourceFile.name ?? "New drawing",
    networkType: network,
    frequencyHz: frequency,
    symbolSet: symbols,
    origin: "uploaded",
  };
  const load = async (file: File) => {
    controller.current?.abort();
    controller.current = new AbortController();
    const current = controller.current;
    setStage("Reading the local file…");
    setInput(null);
    try {
      const ingested = await ingestFile(file, {
        signal: current.signal,
        dpi: 300,
        manualRotationDegree: rotation || undefined,
        deskew: true,
        onProgress: (p) =>
          setStage(`${p.stage}: ${p.message} (${p.page}/${p.pages})`),
      });
      await storeBlob(ingested.sourceFile.file_id, file);
      ingested.sourceFile.browser_blob_key = ingested.sourceFile.file_id;
      for (const p of ingested.pages)
        await storeBlob(
          `page:${ingested.sourceFile.file_id}:${p.metadata.page}`,
          p.raster,
        );
      if (controller.current === current && !current.signal.aborted)
        setInput(ingested);
    } catch (e) {
      if (controller.current === current && !current.signal.aborted)
        onError(
          e instanceof Error ? e.message : "The drawing could not be read.",
        );
    } finally {
      if (controller.current === current) setStage("");
    }
  };
  const sample = async (extension: "pdf" | "png" | "tiff") => {
    if (!privacy || stage) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setStage(`Loading sample ${extension.toUpperCase()}…`);
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}drawings/synthetic-training.${extension}`,
        { signal: abort.signal, credentials: "omit" },
      );
      if (!response.ok)
        throw new Error(
          `The sample drawing could not be loaded (HTTP ${response.status}).`,
        );
      const blob = await response.blob();
      await load(
        new File([blob], `synthetic-training.${extension}`, {
          type: extension === "pdf" ? "application/pdf" : `image/${extension}`,
        }),
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        onError(
          e instanceof Error ? e.message : "The sample could not be loaded.",
        );
    } finally {
      setStage("");
    }
  };
  const extract = async () => {
    if (!input) return;
    controller.current = new AbortController();
    const current = controller.current;
    setStage("Starting the requested image extraction…");
    try {
      const result = await extractDocument(
        input,
        createOpenAIVisionAdapter({ apiKey: key, model }),
        {
          signal: current.signal,
          draft: settings,
          maxRequests: budget,
          maxRefinements: 12,
          onProgress: (p) =>
            setStage(
              `${p.stage}: ${p.message} · ${p.completed}/${p.total} · ${p.requests} requests`,
            ),
        },
      );
      if (controller.current !== current || current.signal.aborted) return;
      onComplete(result.document);
      if (result.report.warnings.length)
        onError(`Extraction review notes: ${result.report.warnings.join(" ")}`);
    } catch (e) {
      if (controller.current === current && !current.signal.aborted)
        onError(
          e instanceof Error ? e.message : "Extraction did not complete.",
        );
    } finally {
      if (controller.current === current) {
        setStage("");
        setKey("");
      }
    }
  };
  return (
    <div className="upload-grid">
      <section className="panel">
        <div className="panel-header">
          <h3>01 / Local drawing</h3>
          <span className="sample-badge">PDF · PNG · JPG · TIFF</span>
        </div>
        <div className="completion-content">
          <p>
            Your original files, case and calculations stay in this browser. If
            you choose extraction, image tiles and nearby text go directly to
            OpenAI with your key. No analytics or application server is used.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
            <span>
              I understand what remains local and what the optional vision
              request sends.
            </span>
          </label>
          <label className="stack-label">
            Manual scan correction, degrees (optional)
            <input
              type="number"
              min="-180"
              max="180"
              step="0.1"
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
            />
          </label>
          <div className="button-row">
            <button
              disabled={!privacy || !!stage}
              onClick={() => void sample("pdf")}
            >
              Sample PDF (2 pages)
            </button>
            <button
              disabled={!privacy || !!stage}
              onClick={() => void sample("tiff")}
            >
              Sample TIFF (2 pages)
            </button>
            <button
              disabled={!privacy || !!stage}
              onClick={() => void sample("png")}
            >
              Sample PNG
            </button>
          </div>
          <p className="small-note">
            Fictional practice drawings. Loading a sample stays in this browser.
          </p>
          <label className="upload-drop">
            Choose a drawing
            <input
              type="file"
              disabled={!privacy || !!stage}
              accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/png,image/jpeg,image/tiff"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void load(file);
                e.target.value = "";
              }}
            />
          </label>
          {input && (
            <>
              <p>
                {input.pages.length} page(s) ·{" "}
                {input.pages.reduce((n, p) => n + p.tiles.length, 0)}{" "}
                overlapping tiles · at least 300 DPI for PDFs
              </p>
              {input.warnings.map((warning, i) => (
                <p key={i} className="small-note">
                  △ {warning}
                </p>
              ))}
              <img
                className="upload-preview"
                src={preview}
                alt="First page of the uploaded drawing"
              />
              <details>
                <summary>Preprocessing details</summary>
                <pre>
                  {JSON.stringify(
                    input.pages.map((p) => ({
                      page: p.metadata.page,
                      dpi: p.metadata.raster_dpi,
                      tiles: p.tiles.length,
                      textSpans: p.metadata.text_spans.length,
                      deskew: p.deskew,
                    })),
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h3>02 / Extract into a review draft</h3>
        </div>
        <div className="form-body">
          <label>
            Network type
            <select
              value={network ?? ""}
              onChange={(e) =>
                setNetwork(e.target.value as DraftOptions["networkType"])
              }
            >
              <option value="">Choose network type</option>
              <option value="transmission_subtransmission">
                Transmission / sub-transmission
              </option>
              <option value="industrial">Industrial plant</option>
              <option value="distribution">
                Distribution feeder (balanced)
              </option>
            </select>
          </label>
          <label>
            Frequency
            <select
              value={frequency ?? ""}
              onChange={(e) => setFrequency(Number(e.target.value) as 50 | 60)}
            >
              <option value="">Choose frequency</option>
              <option value="50">50 Hz</option>
              <option value="60">60 Hz</option>
            </select>
          </label>
          <label>
            Drawing symbols
            <select
              value={symbols}
              onChange={(e) =>
                setSymbols(e.target.value as "IEC" | "ANSI_IEEE")
              }
            >
              <option value="IEC">IEC</option>
              <option value="ANSI_IEEE">ANSI / IEEE</option>
            </select>
          </label>
          <label>
            OpenAI API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label>
            Vision-capable model ID
            <input
              autoComplete="off"
              spellCheck={false}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <a
            href="https://developers.openai.com/api/docs/models"
            target="_blank"
            rel="noreferrer"
          >
            Model capabilities ↗
          </a>
          <label>
            Maximum image requests (including retries and zoomed regions)
            <input
              type="number"
              min="1"
              max="500"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Send this drawing’s tiles, legend crops and nearby text to OpenAI.
              My account pays API charges. The request uses store:false;
              provider retention rules still apply.
            </span>
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={
                !input ||
                !key.trim() ||
                !model.trim() ||
                !consent ||
                !network ||
                !frequency ||
                !!stage ||
                budget < 1 ||
                budget > 500
              }
              onClick={() => void extract()}
            >
              Extract and review
            </button>
            <button
              disabled={!input || !network || !frequency || !!stage}
              onClick={() => {
                const draft = createDraft(settings);
                draft.source_files = [input!.sourceFile];
                onComplete(draft);
              }}
            >
              Build manually from drawing
            </button>
            <button
              onClick={() => {
                controller.current?.abort();
                setKey("");
              }}
            >
              Clear key / cancel
            </button>
          </div>
          {stage && (
            <div role="status" className="progress-region">
              <progress />
              <p>{stage}</p>
            </div>
          )}
          <p className="small-note">
            This produces a draft, never an automatically approved electrical
            case. Missing engineering quantities stay missing. Real-world
            accuracy has not been measured.
          </p>
        </div>
      </section>
    </div>
  );
}
