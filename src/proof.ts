import type { SolutionRun } from './model';

export interface NativeReference {
  fixture_id: string;
  pandapower_version: string;
  generated_at: string;
  buses: { busbar_id: string; voltage_pu: number; voltage_kv: number; angle_degree: number; net_p_mw: number; net_q_mvar: number }[];
  system: { total_generation_mw: number; total_served_load_mw: number; total_loss_mw: number };
}
export function compareWithReference(run: SolutionRun, reference: NativeReference) {
  const rows = reference.buses.map(expected => {
    const actual = run.results?.buses.find(bus => bus.busbar_ids.includes(expected.busbar_id));
    const voltage = actual?.voltage_pu.status === 'available' ? actual.voltage_pu.value : null;
    return { id: expected.busbar_id, expected: expected.voltage_pu, actual: voltage,
      error: voltage === null ? null : Math.abs(voltage - expected.voltage_pu) };
  });
  const complete = rows.length > 0 && rows.every(row => row.error !== null && Number.isFinite(row.error)) &&
    run.results?.buses.flatMap(bus => bus.busbar_ids).length === reference.buses.length;
  const maxError = complete ? Math.max(...rows.map(row => row.error!)) : null;
  return { rows, maxError, passed: run.status === 'converged' && complete && maxError !== null && maxError <= 1e-6 };
}
