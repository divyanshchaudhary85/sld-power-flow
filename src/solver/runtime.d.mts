import type { Finding, SolutionRun, StudyDocument } from "../model/types";
import type { CaseExport, CaseFormat } from "./protocol";
export interface RuntimeManifest {
  schema_version: number;
  pyodide_version: string;
  pandapower_version: string;
  package_lock_digest: string;
  total_bytes: number;
  load_packages: string[];
  wheels: Array<{
    name: string;
    version: string;
    path: string;
    sha256: string;
    bytes: number;
  }>;
  adapter: { path: string; sha256: string; bytes: number };
  exporter?: { path: string; sha256: string; bytes: number };
}
export interface RuntimeProgress {
  stage:
    | "loading-python"
    | "loading-packages"
    | "installing-wheels"
    | "loading-adapter"
    | "ready";
  message: string;
  completed?: number;
  total?: number;
  loadMs?: number;
}
export interface SolverRuntime {
  manifest: RuntimeManifest;
  loadMs: number;
}
export function initializeRuntime(options: {
  indexURL: string;
  manifest: RuntimeManifest;
  loadPyodide: (options: Record<string, unknown>) => Promise<unknown>;
  readBytes: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
  onProgress?: (progress: RuntimeProgress) => void;
}): Promise<SolverRuntime>;
export function solveRuntime(
  runtime: SolverRuntime,
  document: StudyDocument,
  inputHash?: string,
): SolutionRun;
export function exportRuntime(
  runtime: SolverRuntime,
  document: StudyDocument,
  format: CaseFormat,
  inputHash: string,
): CaseExport;
export function diagnoseRuntime(
  runtime: SolverRuntime,
  document: StudyDocument,
): Finding[];
export function verifyDigest(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
  label: string,
): Promise<void>;
