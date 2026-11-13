import type { StudyDocument } from '../model/types';
import { getAtPath } from '../model/editing';
import { analyzeTopology } from '../validation/topology';
import { dataOf, fieldValue } from '../validation/values';

export interface MissingData { path: string; elementId: string | null; attribute: string; label: string; kind: 'value' | 'confirmation'; unit: string; reason: string }
export const inputUnit = (key: string) => key.endsWith('_mvar') ? 'MVAr' : key.endsWith('_mw') ? 'MW' : key.endsWith('_mva') ? 'MVA' : key.endsWith('_kv') ? 'kV' : key.endsWith('_ka') ? 'kA' : key.endsWith('_km') && !key.includes('_per_') ? 'km' : key.includes('ohm_per_km') ? 'Ω/km' : key.includes('us_per_km') ? 'µS/km' : key.endsWith('_percent') ? '%' : key.endsWith('_degree') ? '°' : key.endsWith('_hz') ? 'Hz' : '';
export function listMissingData(document: StudyDocument): MissingData[] {
  const rows: MissingData[] = [];
  const require = (path: string, elementId: string | null = null, nullable = false, confirmation = false) => {
    const field = getAtPath(document, path); const value = fieldValue(field); const key = path.split('/').at(-1)!;
    if (value === undefined || (!nullable && value === null) || (confirmation && value !== true)) rows.push({ path, elementId, attribute: key, label: key.replaceAll('_', ' '), kind: confirmation ? 'confirmation' : 'value', unit: inputUnit(key), reason: confirmation ? 'Explicit confirmation required' : 'Required solver input is missing' });
  };
  for (const key of ['name', 'network_type', 'frequency_hz', 'base_mva']) require(`/meta/${key}`);
  for (const key of ['slack_element_id', 'solver_tolerance_mva', 'max_iterations', 'enforce_q_limits', 'voltage_min_pu', 'voltage_max_pu',
    'branch_warning_percent', 'branch_alarm_percent', 'transformer_z_min_percent', 'transformer_z_max_percent', 'nominal_voltage_tolerance_percent',
    'low_confidence_threshold', 'voltage_unit_slip_ratio', 'power_unit_slip_ratio', 'allow_slack_export']) require(`/settings/${key}`);
  require('/settings/slack_import_limit_mw', null, true);
  require('/settings/base_confirmed', null, false, true); require('/settings/slack_confirmed', null, false, true);
  const keys: Record<string, string[]> = {
    busbar: ['nominal_kv'], line: ['length_km', 'r_ohm_per_km', 'x_ohm_per_km', 'b_us_per_km', 'g_us_per_km', 'max_current_ka', 'parallel_count', 'derating_factor'],
    transformer_2w: ['sn_mva', 'vn_hv_kv', 'vn_lv_kv', 'vk_percent', 'vkr_percent', 'pfe_kw', 'i0_percent', 'phase_shift_degree', 'parallel_count', 'derating_factor', 'tap'],
    external_grid: ['voltage_setpoint_kv', 'mode'], generator: ['voltage_setpoint_kv', 'mode'], static_generator: ['p_mw', 'q_mvar'],
    load: ['p_mw', 'q_mvar', 'scaling_factor', 'model'], shunt: ['p_mw', 'q_mvar', 'nominal_kv', 'step', 'max_step', 'model'],
    circuit_breaker: ['state', 'electrical_model'], disconnector: ['state', 'electrical_model'], fuse: ['state', 'electrical_model'],
  };
  keys.cable = keys.line; keys.motor = keys.load;
  const slacks = new Set([fieldValue(document.settings.slack_element_id), ...document.operation.island_policy.energized_island_slacks.map(island => island.slack_element_id)]);
  document.elements.forEach((element, index) => {
    const path = `/elements/${index}`; require(`${path}/in_service`, element.id);
    for (const role of Object.keys(element.terminals)) require(`${path}/terminals/${role}/connection_point`, element.id);
    for (const key of keys[element.type.value] ?? []) require(`${path}/data/${key}`, element.id);
    if (element.type.value === 'external_grid') require(`${path}/data/${slacks.has(element.id) ? 'angle_degree' : 'p_dispatch_mw'}`, element.id);
    if (element.type.value === 'generator') {
      if (slacks.has(element.id)) require(`${path}/data/slack_angle_degree`, element.id);
      else { require(`${path}/data/p_mw`, element.id); require(`${path}/data/min_q_mvar`, element.id, true); require(`${path}/data/max_q_mvar`, element.id, true); }
    }
    const tap = fieldValue<Record<string, unknown>>(dataOf(element).tap);
    if (tap?.kind === 'fixed') for (const key of ['side', 'neutral', 'position', 'step_percent', 'step_degree', 'changer_type']) require(`${path}/data/tap/value/${key}`, element.id);
    if (element.type.value === 'unknown') rows.push({ path: `${path}/type`, elementId: element.id, attribute: 'type', label: 'recognized equipment type', kind: 'value', unit: '', reason: 'Retype or remove unrecognized equipment before solving' });
  });
  // Where no drawing bus supplies a base, the line-end input is the editable completion point.
  const topology = analyzeTopology(document);
  for (const node of topology.nodes.filter(node => !node.nominalKvValues.length)) {
    const branchIndex = document.elements.findIndex(element => ['line', 'cable'].includes(element.type.value) && Object.values(topology.terminalNodes[element.id]).includes(node.id));
    if (branchIndex >= 0) {
      const element = document.elements[branchIndex]; const terminals = topology.terminalNodes[element.id];
      require(`/elements/${branchIndex}/data/${terminals.from === node.id ? 'from_nominal_kv' : 'to_nominal_kv'}`, element.id);
    }
  }
  return rows;
}
