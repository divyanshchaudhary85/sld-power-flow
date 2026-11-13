import type { DataSuggestion, JsonValue, Provenance, StudyDocument } from '../model/types';
import { commitEngineeringEdit } from '../model/revision';
import { getAtPath, missingValue, replaceAtPath } from '../model/editing';
import { fieldValue } from '../validation/values';
export { listMissingData, inputUnit } from './missing';
export type { MissingData } from './missing';

export interface StandardType { id: string; label: string; elementKinds: string[]; values: Record<string, number>; capacitanceNfPerKm?: number; tap?: { side: 'hv' | 'lv'; neutral: number; min: number; max: number; stepPercent: number; stepDegree: number } }
/** Verified against installed pandapower 3.3.3 basic_std_types. Ratings are library assumptions, never measured data. */
export const STANDARD_TYPES: StandardType[] = [
  { id: 'NAYY 4x50 SE', label: 'NAYY 4×50 SE · LV cable', elementKinds: ['cable'], values: { r_ohm_per_km: 0.642, x_ohm_per_km: 0.083, max_current_ka: 0.142 }, capacitanceNfPerKm: 210 },
  { id: 'NAYY 4x150 SE', label: 'NAYY 4×150 SE · LV cable', elementKinds: ['cable'], values: { r_ohm_per_km: 0.208, x_ohm_per_km: 0.08, max_current_ka: 0.27 }, capacitanceNfPerKm: 261 },
  { id: '149-AL1/24-ST1A 110.0', label: '149-AL1/24-ST1A · 110 kV overhead', elementKinds: ['line'], values: { r_ohm_per_km: 0.194, x_ohm_per_km: 0.41, max_current_ka: 0.47 }, capacitanceNfPerKm: 8.75 },
  { id: '25 MVA 110/20 kV', label: '25 MVA · 110/20 kV · YNd5', elementKinds: ['transformer_2w'], values: { sn_mva: 25, vn_hv_kv: 110, vn_lv_kv: 20, vk_percent: 12, vkr_percent: 0.41, pfe_kw: 14, i0_percent: 0.07, phase_shift_degree: 150 }, tap: { side: 'hv', neutral: 0, min: -9, max: 9, stepPercent: 1.5, stepDegree: 0 } },
  { id: '0.4 MVA 20/0.4 kV', label: '0.4 MVA · 20/0.4 kV · Dyn5', elementKinds: ['transformer_2w'], values: { sn_mva: 0.4, vn_hv_kv: 20, vn_lv_kv: 0.4, vk_percent: 6, vkr_percent: 1.425, pfe_kw: 1.35, i0_percent: 0.3375, phase_shift_degree: 150 }, tap: { side: 'hv', neutral: 0, min: -2, max: 2, stepPercent: 2.5, stepDegree: 0 } },
];
export function applyStandardType(document: StudyDocument, elementId: string, typeId: string, at = new Date().toISOString()): StudyDocument {
  const type = STANDARD_TYPES.find(type => type.id === typeId); if (!type) throw new Error('Unknown standard type.');
  const index = document.elements.findIndex(element => element.id === elementId); if (index < 0) throw new Error('Unknown element.');
  if (!type.elementKinds.includes(document.elements[index].type.value)) throw new Error('This standard type is for a different equipment kind.');
  const provenance: Provenance = { source: 'library', library_id: 'pandapower.basic_std_types', library_version: '3.3.3', item_id: type.id, accepted_at: at };
  const known = <T,>(value: T) => ({ status: 'known' as const, value, provenance, derivation: null });
  return commitEngineeringEdit(document, draft => {
    for (const [key, value] of Object.entries(type.values)) replaceAtPath(draft, `/elements/${index}/data/${key}`, known(value));
    if (type.capacitanceNfPerKm !== undefined) {
      const frequency = fieldValue<number>(draft.meta.frequency_hz); if (!frequency) throw new Error('Select case frequency before applying a line type.');
      replaceAtPath(draft, `/elements/${index}/data/b_us_per_km`, { ...known(2 * Math.PI * frequency * type.capacitanceNfPerKm / 1000),
        derivation: { rule_id: 'CAPACITANCE_TO_SUSCEPTANCE', rule_version: '1.0.0', input_paths: ['/meta/frequency_hz'], description: `B = 2πfC; C=${type.capacitanceNfPerKm} nF/km from ${type.id}.` } });
    }
    if (type.tap) {
      const tap = type.tap;
      replaceAtPath(draft, `/elements/${index}/data/tap`, known({ kind: 'fixed', side: known(tap.side), neutral: known(tap.neutral), min: known(tap.min), max: known(tap.max),
        position: missingValue(), step_percent: known(tap.stepPercent), step_degree: known(tap.stepDegree), changer_type: known('ratio'), ratio_definition: known('pandapower Ratio tap model') }));
    }
    replaceAtPath(draft, `/elements/${index}/data/standard_type`, known({ library_id: 'pandapower.basic_std_types', version: '3.3.3', item_id: type.id }));
  }, at);
}

const defaults: Record<string, { value: JsonValue; rationale: string }> = {
  base_mva: { value: 100, rationale: 'Explicit study base; it is not an equipment rating.' },
  solver_tolerance_mva: { value: 1e-8, rationale: 'Specified numerical convergence tolerance.' },
  max_iterations: { value: 30, rationale: 'Explicit Newton–Raphson iteration limit.' },
  enforce_q_limits: { value: true, rationale: 'Enforce the reactive capability bounds entered for generators.' },
  parallel_count: { value: 1, rationale: 'Assume a single circuit/unit; confirm against the installation.' },
  derating_factor: { value: 1, rationale: 'No thermal derating assumed; confirm installation conditions.' },
  scaling_factor: { value: 1, rationale: 'Use the entered demand without an additional multiplier.' },
  g_us_per_km: { value: 0, rationale: 'Neglect line dielectric conductance in this study.' },
  pfe_kw: { value: 0, rationale: 'Neglect transformer core losses; an engineering assumption requiring acceptance.' },
  i0_percent: { value: 0, rationale: 'Neglect transformer no-load magnetizing current.' },
  voltage_min_pu: { value: 0.95, rationale: 'Initial lower voltage alarm threshold from the study specification.' },
  voltage_max_pu: { value: 1.05, rationale: 'Initial upper voltage alarm threshold from the study specification.' },
  branch_warning_percent: { value: 80, rationale: 'Initial loading warning threshold from the study specification.' },
  branch_alarm_percent: { value: 100, rationale: 'Initial loading alarm threshold from the study specification.' },
  transformer_z_min_percent: { value: 2, rationale: 'Initial transformer impedance plausibility bound.' },
  transformer_z_max_percent: { value: 25, rationale: 'Initial transformer impedance plausibility bound.' },
  nominal_voltage_tolerance_percent: { value: 1, rationale: 'Explicit nominal-voltage comparison tolerance.' },
  low_confidence_threshold: { value: 0.85, rationale: 'Initial extraction-review confidence threshold.' },
  voltage_unit_slip_ratio: { value: 1000, rationale: 'Factor between volts and kilovolts.' },
  power_unit_slip_ratio: { value: 1000, rationale: 'Factor between kVA and MVA.' },
  allow_slack_export: { value: false, rationale: 'Warn when the reference source absorbs active power.' },
  slack_import_limit_mw: { value: null, rationale: 'No additional active-power infeed limit; entered nameplate capability is still checked.' },
};
export function suggestedDefaults(document: StudyDocument): DataSuggestion[] {
  const suggestions: DataSuggestion[] = [];
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}/${index}`)); return; }
    const object = value as Record<string, unknown>;
    if (object.status === 'missing') {
      const proposal = defaults[path.split('/').at(-1)!];
      if (proposal) suggestions.push({ id: `default:${path}`, target_path: path, candidate_value: proposal.value, source: 'default', source_id: `study-default:${path.split('/').at(-1)}`, source_version: '1.0.0', rationale: proposal.rationale, status: 'offered' });
      return;
    }
    if (object.status === 'known') { visit(object.value, `${path}/value`); return; }
    for (const [key, entry] of Object.entries(object)) visit(entry, `${path}/${key}`);
  };
  visit(document.meta, '/meta'); visit(document.settings, '/settings'); visit(document.elements, '/elements');
  return suggestions;
}
export function acceptSuggestion(document: StudyDocument, suggestion: DataSuggestion, at = new Date().toISOString()): StudyDocument {
  if (suggestion.status !== 'offered') throw new Error('Only an offered suggestion can be accepted.');
  const existing = getAtPath(document, suggestion.target_path);
  if (!existing || typeof existing !== 'object' || !('status' in existing)) throw new Error('The suggestion does not target an input field.');
  if (existing.status !== 'missing') throw new Error('This input has already been completed; review it before replacing it.');
  return commitEngineeringEdit(document, draft => {
    const provenance: Provenance = suggestion.source === 'default'
      ? { source: 'default', default_id: suggestion.source_id, default_version: suggestion.source_version, accepted_at: at, rationale: suggestion.rationale }
      : { source: 'library', library_id: suggestion.source_id, library_version: suggestion.source_version, item_id: suggestion.id, accepted_at: at };
    replaceAtPath(draft, suggestion.target_path, { status: 'known', value: suggestion.candidate_value, provenance, derivation: null });
    draft.data_suggestions = [...draft.data_suggestions.filter(entry => entry.id !== suggestion.id), { ...suggestion, status: 'accepted' }];
  }, at);
}
