import type { Element, SourceRef, DrawingRef } from '../model/types';

export function fieldValue<T = unknown>(field: unknown): T | undefined {
  return field !== null && typeof field === 'object' && 'status' in field && field.status === 'known' && 'value' in field
    ? field.value as T : undefined;
}
export const dataOf = (element: Element): Record<string, unknown> => element.data as unknown as Record<string, unknown>;
export const numberValue = (field: unknown): number | undefined => {
  const value = fieldValue(field); return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
export const numberOf = (element: Element, key: string) => numberValue(dataOf(element)[key]);
export const active = (element: Element) => fieldValue(element.in_service) === true;
export const isSwitch = (element: Element) => ['circuit_breaker', 'disconnector', 'fuse'].includes(element.type.value);
export const isBranch = (element: Element) => ['line', 'cable', 'transformer_2w'].includes(element.type.value);
export const isSource = (element: Element) => ['external_grid', 'generator'].includes(element.type.value);
export function sourceLocations(ref: SourceRef): DrawingRef[] {
  return ref.kind === 'drawing' ? [ref.primary, ...ref.evidence]
    : ref.kind === 'synthetic' ? ref.generated_drawing ? [ref.generated_drawing] : []
    : ref.manually_marked_region ? [ref.manually_marked_region] : [];
}
