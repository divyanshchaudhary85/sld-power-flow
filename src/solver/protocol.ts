import type { Finding, SolutionRun, StudyDocument } from "../model/types";
import type { RuntimeProgress } from "./runtime.mjs";
export type SolverRequest =
  | { type: "initialize"; requestId: string; runtimeBaseURL: string }
  | {
      type: "solve";
      requestId: string;
      document: StudyDocument;
      inputHash: string;
    }
  | {
      type: "export";
      requestId: string;
      document: StudyDocument;
      inputHash: string;
      format: CaseFormat;
    }
  | {
      type: "diagnose";
      requestId: string;
      document: StudyDocument;
      inputHash: string;
    };
export type CaseFormat = "pandapower-json" | "matpower" | "psse-raw";
export interface CaseExport {
  format: CaseFormat;
  filename: string;
  mime_type: string;
  encoding: "utf-8" | "base64";
  data: string;
  warnings: string[];
  model_revision: number;
  input_hash: string;
}
export type SolverResponse =
  | { type: "progress"; requestId: string; progress: RuntimeProgress }
  | {
      type: "ready";
      requestId: string;
      loadMs: number;
      solverVersion: string;
      runtimeVersion: string;
      packageLockDigest: string;
    }
  | {
      type: "solution";
      requestId: string;
      revision: number;
      inputHash: string;
      solution: SolutionRun;
      elapsedMs: number;
    }
  | { type: "exported"; requestId: string; result: CaseExport }
  | { type: "diagnostics"; requestId: string; findings: Finding[] }
  | { type: "error"; requestId: string; message: string };
