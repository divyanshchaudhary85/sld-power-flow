/// <reference lib="webworker" />
import type { SolverRequest, SolverResponse } from "./protocol";
import { computeInputHash } from "../model/revision";
import { assertStudyDocument } from "../model/validation";
import {
  initializeRuntime,
  solveRuntime,
  exportRuntime,
  diagnoseRuntime,
  type RuntimeManifest,
  type SolverRuntime,
} from "./runtime.mjs";

const worker = self as DedicatedWorkerGlobalScope;
let runtime: SolverRuntime | null = null;
let initializing: Promise<SolverRuntime> | null = null;
const send = (response: SolverResponse) => worker.postMessage(response);

worker.onmessage = async (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  try {
    if (request.type === "initialize") {
      const base = new URL(request.runtimeBaseURL);
      if (base.origin !== worker.location.origin)
        throw new Error("Solver assets must be hosted on the same origin.");
      if (!base.pathname.endsWith("/")) base.pathname += "/";
      const readBytes = async (path: string) => {
        const url = new URL(path, base);
        if (
          url.origin !== base.origin ||
          !url.pathname.startsWith(base.pathname)
        )
          throw new Error("Invalid solver asset location.");
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            `Could not load solver asset ${path} (HTTP ${response.status}).`,
          );
        return new Uint8Array(await response.arrayBuffer());
      };
      if (!initializing)
        initializing = (async () => {
          const manifest = JSON.parse(
            new TextDecoder().decode(await readBytes("runtime-manifest.json")),
          ) as RuntimeManifest;
          const loaderURL = new URL("pyodide.mjs", base).href;
          const loader = (await import(/* @vite-ignore */ loaderURL)) as {
            loadPyodide: (options: Record<string, unknown>) => Promise<unknown>;
          };
          return initializeRuntime({
            indexURL: base.href,
            manifest,
            loadPyodide: loader.loadPyodide,
            readBytes,
            onProgress: (progress) =>
              send({
                type: "progress",
                requestId: request.requestId,
                progress,
              }),
          });
        })();
      runtime = await initializing;
      send({
        type: "ready",
        requestId: request.requestId,
        loadMs: runtime.loadMs,
        solverVersion: runtime.manifest.pandapower_version,
        runtimeVersion: runtime.manifest.pyodide_version,
        packageLockDigest: runtime.manifest.package_lock_digest,
      });
    } else {
      if (!runtime)
        throw new Error("Load the solver before requesting a study.");
      const started = performance.now();
      assertStudyDocument(request.document);
      if ((await computeInputHash(request.document)) !== request.inputHash)
        throw new Error("The requested case hash does not match its inputs.");
      if (request.type === "diagnose") {
        send({
          type: "diagnostics",
          requestId: request.requestId,
          findings: diagnoseRuntime(runtime, request.document),
        });
        return;
      }
      if (
        request.document.review.status !== "confirmed" ||
        request.document.review.confirmed_model_revision !==
          request.document.revision ||
        request.document.review.confirmed_input_hash !== request.inputHash
      )
        throw new Error("The exact requested inputs have not been reviewed.");
      if (request.type === "export") {
        send({
          type: "exported",
          requestId: request.requestId,
          result: exportRuntime(
            runtime,
            request.document,
            request.format,
            request.inputHash,
          ),
        });
        return;
      }
      const solution = solveRuntime(
        runtime,
        request.document,
        request.inputHash,
      );
      if (
        solution.model_revision !== request.document.revision ||
        solution.input_hash !== request.inputHash
      ) {
        throw new Error(
          "The solver response did not match the requested input revision.",
        );
      }
      send({
        type: "solution",
        requestId: request.requestId,
        revision: request.document.revision,
        inputHash: request.inputHash,
        solution,
        elapsedMs: performance.now() - started,
      });
    }
  } catch (error) {
    if (request.type === "initialize") {
      runtime = null;
      initializing = null;
    }
    send({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
