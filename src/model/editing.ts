import type { DrawingRef, Element, JsonValue, Provenance, StudyDocument } from './types';
import { commitEngineeringEdit } from './revision';

export function userValue<T>(value: T, at = new Date().toISOString(), evidence: DrawingRef[] = []) {
  return { status: 'known' as const, value, provenance: { source: 'user' as const, changed_at: at,
    supersedes_path: null, evidence }, derivation: null };
}
export function missingValue(reason: 'not_shown' | 'unreadable' | 'ambiguous' | 'not_entered' = 'not_entered') {
  return { status: 'missing' as const, reason, candidates: [], evidence: [] };
}
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export function getAtPath(root: unknown, path: string): unknown {
  if (!path.startsWith('/')) throw new Error('Input paths must be JSON Pointers.');
  return path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((value, key) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid input path.');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`Unknown input path: ${path}`);
    return (value as Record<string, unknown>)[key];
  }, root);
}
export function replaceAtPath(root: unknown, path: string, value: unknown): void {
  const slash = path.lastIndexOf('/'); const parent = slash === 0 ? root : getAtPath(root, path.slice(0, slash));
  const key = path.slice(slash + 1).replace(/~1/g, '/').replace(/~0/g, '~');
  if (['__proto__', 'constructor', 'prototype'].includes(key) || parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error(`Unknown input path: ${path}`);
  (parent as Record<string, unknown>)[key] = value;
}
/** A changed source input invalidates conversions derived from it; the UI must recomplete them. */
function invalidateDerived(document: StudyDocument, changedPaths: string[]): void {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') {
        const field = child as { status?: string; derivation?: { input_paths?: string[] } | null };
        if (field.status === 'known' && field.derivation?.input_paths?.some(source => changedPaths.some(path => source === path || source.startsWith(`${path}/`)))) {
          (value as Record<string, unknown>)[key] = missingValue('not_entered');
        } else visit(child);
      }
    }
  };
  visit(document.elements);
}
export function updateInput(document: StudyDocument, path: string, value: JsonValue, at = new Date().toISOString()): StudyDocument {
  return commitEngineeringEdit(document, draft => {
    const previous = getAtPath(draft, path);
    if (!previous || typeof previous !== 'object' || !('status' in previous) || !['known', 'missing'].includes(String(previous.status))) throw new Error('Only provenance-bearing inputs may be edited with updateInput.');
    replaceAtPath(draft, path, userValue(value, at));
    invalidateDerived(draft, [path]);
  }, at);
}
export function editElementData(document: StudyDocument, id: string, changes: Record<string, JsonValue>, at = new Date().toISOString()) {
  const index = document.elements.findIndex(element => element.id === id); if (index < 0) throw new Error(`Unknown element: ${id}`);
  return commitEngineeringEdit(document, draft => {
    const paths = Object.keys(changes).map(key => `/elements/${index}/data/${escape(key)}`);
    for (const [key, value] of Object.entries(changes)) replaceAtPath(draft, `/elements/${index}/data/${escape(key)}`, userValue(value, at));
    invalidateDerived(draft, paths);
  }, at);
}
export function editMeta(document: StudyDocument, changes: Record<string, JsonValue>, at = new Date().toISOString()) {
  return commitEngineeringEdit(document, draft => {
    for (const [key, value] of Object.entries(changes)) {
      const path = `/meta/${escape(key)}`; const old = getAtPath(draft, path);
      if (!old || typeof old !== 'object' || !('status' in old)) throw new Error('Only editable case metadata may be changed.');
      replaceAtPath(draft, path, userValue(value, at));
    }
    invalidateDerived(draft, Object.keys(changes).map(key => `/meta/${escape(key)}`));
  }, at);
}
export function reconnectTerminal(document: StudyDocument, id: string, role: string, pointId: string | null, at = new Date().toISOString()) {
  const index = document.elements.findIndex(element => element.id === id); if (index < 0) throw new Error(`Unknown element: ${id}`);
  return commitEngineeringEdit(document, draft => replaceAtPath(draft, `/elements/${index}/terminals/${escape(role)}/connection_point`, pointId === null ? missingValue() : userValue(pointId, at)), at);
}
export function removeElement(document: StudyDocument, id: string, at = new Date().toISOString()) {
  if (!document.elements.some(element => element.id === id)) throw new Error(`Unknown element: ${id}`);
  return commitEngineeringEdit(document, draft => {
    draft.elements = draft.elements.filter(element => element.id !== id);
    const referencedPoints = new Set(draft.elements.flatMap(element => Object.values(element.terminals)
      .flatMap(terminal => terminal.connection_point.status === 'known' ? [terminal.connection_point.value] : [])));
    draft.connectivity_points = draft.connectivity_points.filter(point => referencedPoints.has(point.id));
    // Array indices have changed, so old JSON-Pointer proposals cannot be applied safely.
    draft.data_suggestions = [];
    draft.review.unresolved_element_ids = draft.review.unresolved_element_ids.filter(value => value !== id);
    if (draft.settings.slack_element_id.status === 'known' && draft.settings.slack_element_id.value === id) {
      draft.settings.slack_element_id = missingValue(); draft.settings.slack_confirmed = userValue(false, at);
    }
    draft.operation.island_policy.authorized_isolated_element_ids = draft.operation.island_policy.authorized_isolated_element_ids.filter(value => value !== id);
    draft.operation.island_policy.energized_island_slacks = draft.operation.island_policy.energized_island_slacks.filter(island => island.slack_element_id !== id);
    draft.operation.island_policy.energized_island_slacks.forEach(island => {
      island.connectivity_point_ids = island.connectivity_point_ids.filter(point => referencedPoints.has(point));
    });
  }, at);
}
export interface AssumptionRow { path: string; elementId: string | null; attribute: string; value: unknown; source: 'user' | 'library' | 'default'; provenance: Provenance }
/** Current accepted inputs only. Suggestions, result values and saved baseline copies are excluded. */
export function assumptionsRegister(document: StudyDocument): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  const visit = (value: unknown, path: string, elementId: string | null) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}/${index}`, elementId)); return; }
    const object = value as Record<string, unknown>;
    if (object.status === 'missing') return;
    if (object.status === 'known') {
      const provenance = object.provenance as Provenance;
      if (provenance.source !== 'drawing') rows.push({ path, elementId, attribute: path.split('/').at(-1)!, value: object.value, source: provenance.source, provenance });
      visit(object.value, `${path}/value`, elementId); return;
    }
    for (const [key, entry] of Object.entries(object)) visit(entry, `${path}/${escape(key)}`, elementId);
  };
  visit(document.meta, '/meta', null); visit(document.settings, '/settings', null);
  document.elements.forEach((element: Element, index) => visit(element, `/elements/${index}`, element.id));
  return rows;
}
