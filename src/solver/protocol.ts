import type { SolutionRun, StudyDocument } from '../model/types';
import type { RuntimeProgress } from './runtime.mjs';
export type SolverRequest =
  | { type: 'initialize'; requestId: string; runtimeBaseURL: string }
  | { type: 'solve'; requestId: string; document: StudyDocument; inputHash: string };
export type SolverResponse =
  | { type: 'progress'; requestId: string; progress: RuntimeProgress }
  | { type: 'ready'; requestId: string; loadMs: number; solverVersion: string; runtimeVersion: string; packageLockDigest: string }
  | { type: 'solution'; requestId: string; revision: number; inputHash: string; solution: SolutionRun; elapsedMs: number }
  | { type: 'error'; requestId: string; message: string };
