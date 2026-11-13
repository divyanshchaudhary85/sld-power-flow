import type { StudyDocument } from '../model/types';
import { active, dataOf, fieldValue, isBranch, isSource, isSwitch, numberOf } from './values';

export interface TopologyNode { id: string; pointIds: string[]; busbarIds: string[]; nominalKv: number | null; nominalKvValues: number[] }
export interface TopologyComponent { id: string; nodeIds: string[]; pointIds: string[]; elementIds: string[]; sourceIds: string[]; slackIds: string[]; energized: boolean; intentionalOutage: boolean }
export interface TopologyAnalysis {
  nodes: TopologyNode[]; components: TopologyComponent[];
  pointToNode: Record<string, string>; terminalNodes: Record<string, Record<string, string>>;
  energizedElementIds: string[]; deenergizedElementIds: string[]; energizedPointIds: string[]; deenergizedPointIds: string[];
  adjacency: Record<string, { nodeId: string; elementId: string }[]>;
}

/** Pure node-breaker reduction. Missing/dangling draft terminals are deliberately left unmapped. */
export function analyzeTopology(document: StudyDocument, excludedElementIds: readonly string[] = []): TopologyAnalysis {
  const excluded = new Set(excludedElementIds);
  const parent = new Map(document.connectivity_points.map(point => [point.id, point.id]));
  const find = (id: string): string => {
    const next = parent.get(id)!;
    if (next !== id) parent.set(id, find(next));
    return parent.get(id)!;
  };
  const point = (field: unknown) => { const value = fieldValue<string>(field); return value && parent.has(value) ? value : undefined; };
  for (const element of document.elements) {
    if (!active(element) || excluded.has(element.id) || !isSwitch(element) || fieldValue(dataOf(element).state) !== 'closed') continue;
    const ends = Object.values(element.terminals).map(terminal => point(terminal.connection_point));
    if (ends.length === 2 && ends[0] && ends[1]) { const a = find(ends[0]), b = find(ends[1]); parent.set(a > b ? a : b, a > b ? b : a); }
  }
  const pointToNode: Record<string, string> = {};
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) { const root = find(id); pointToNode[id] = root; groups.set(root, [...(groups.get(root) ?? []), id]); }
  const terminalNodes: TopologyAnalysis['terminalNodes'] = {};
  const adjacency: TopologyAnalysis['adjacency'] = Object.fromEntries([...groups.keys()].map(id => [id, []]));
  const voltages = new Map<string, Set<number>>([...groups.keys()].map(id => [id, new Set()]));
  const bars = new Map<string, string[]>([...groups.keys()].map(id => [id, []]));
  for (const element of document.elements) {
    const terminals: Record<string, string> = {};
    for (const [role, terminal] of Object.entries(element.terminals)) {
      const id = point(terminal.connection_point); if (id) terminals[role] = find(id);
    }
    terminalNodes[element.id] = terminals;
    const assign = (role: string, value?: number) => { if (terminals[role] && value !== undefined && value > 0) voltages.get(terminals[role])!.add(value); };
    if (element.type.value === 'busbar') { assign('bus', numberOf(element, 'nominal_kv')); if (terminals.bus) bars.get(terminals.bus)!.push(element.id); }
    if (element.type.value === 'transformer_2w') { assign('hv', numberOf(element, 'vn_hv_kv')); assign('lv', numberOf(element, 'vn_lv_kv')); }
    if (element.type.value === 'shunt') assign('bus', numberOf(element, 'nominal_kv'));
    if (['line', 'cable'].includes(element.type.value)) { assign('from', numberOf(element, 'from_nominal_kv')); assign('to', numberOf(element, 'to_nominal_kv')); }
    const ends = Object.values(terminals);
    if (active(element) && !excluded.has(element.id) && isBranch(element) && ends.length === 2) {
      adjacency[ends[0]].push({ nodeId: ends[1], elementId: element.id });
      adjacency[ends[1]].push({ nodeId: ends[0], elementId: element.id });
    }
  }
  // Propagate a known nominal base only to unknown nodes through same-voltage equipment.
  // Keep conflicting stated values so validation can report them; never average them.
  for (let iteration = 0; iteration < groups.size; iteration++) {
    let changed = false;
    for (const element of document.elements) {
      if (!['line', 'cable'].includes(element.type.value) && !isSwitch(element)) continue;
      const ends = Object.values(terminalNodes[element.id]); if (ends.length !== 2) continue;
      const a = voltages.get(ends[0])!, b = voltages.get(ends[1])!;
      if (a.size && !b.size) { for (const v of a) b.add(v); changed = true; }
      else if (b.size && !a.size) { for (const v of b) a.add(v); changed = true; }
    }
    if (!changed) break;
  }
  const nodes = [...groups].map(([id, pointIds]) => ({ id, pointIds, busbarIds: bars.get(id)!,
    nominalKv: voltages.get(id)!.size === 1 ? [...voltages.get(id)!][0] : null, nominalKvValues: [...voltages.get(id)!] }));
  const selected = new Set([fieldValue<string>(document.settings.slack_element_id), ...document.operation.island_policy.energized_island_slacks.map(island => island.slack_element_id)].filter(Boolean));
  const eventIds = new Set(document.operation.events.map(event => event.id));
  const policy = document.operation.island_policy;
  const hasAuthorization = policy.mode === 'intentional_outage' && policy.authorizing_event_ids.length > 0 && policy.authorizing_event_ids.every(id => eventIds.has(id));
  const authorized = new Set(policy.authorized_isolated_element_ids);
  const remaining = new Set(groups.keys()); const components: TopologyComponent[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as string;
    const reached = reachableNodes(adjacency, first); reached.forEach(id => remaining.delete(id));
    const elements = document.elements.filter(element => active(element) && !excluded.has(element.id) && Object.values(terminalNodes[element.id]).some(id => reached.has(id)));
    const sources = elements.filter(isSource); const slacks = sources.filter(source => selected.has(source.id));
    const required = elements.filter(element => !isSwitch(element));
    components.push({ id: first, nodeIds: [...reached], pointIds: [...reached].flatMap(id => groups.get(id)!),
      elementIds: elements.map(element => element.id), sourceIds: sources.map(source => source.id), slackIds: slacks.map(source => source.id),
      energized: slacks.length > 0, intentionalOutage: !slacks.length && hasAuthorization && required.every(element => authorized.has(element.id)) });
  }
  const energized = new Set(components.filter(component => component.energized).flatMap(component => component.nodeIds));
  const energizedElementIds = document.elements.filter(element => active(element) && !excluded.has(element.id) && Object.values(terminalNodes[element.id]).some(id => energized.has(id))).map(element => element.id);
  const energizedIds = new Set(energizedElementIds);
  return { nodes, components, pointToNode, terminalNodes, adjacency, energizedElementIds,
    deenergizedElementIds: document.elements.filter(element => !energizedIds.has(element.id)).map(element => element.id),
    energizedPointIds: [...parent.keys()].filter(id => energized.has(pointToNode[id])),
    deenergizedPointIds: [...parent.keys()].filter(id => !energized.has(pointToNode[id])) };
}

export function reachableNodes(adjacency: TopologyAnalysis['adjacency'], start: string, excludedElementId?: string): Set<string> {
  const found = new Set<string>(); const queue = [start];
  while (queue.length) { const node = queue.pop()!; if (found.has(node)) continue; found.add(node);
    for (const edge of adjacency[node] ?? []) if (edge.elementId !== excludedElementId && !found.has(edge.nodeId)) queue.push(edge.nodeId); }
  return found;
}
