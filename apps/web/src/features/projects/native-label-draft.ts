import { MAX_DOCUMENT_BYTES } from '@ezerd/contracts';
export const nativeLabelLimit = 1000;
export function parseNativeLabels(raw: string): string[] {
  if (new TextEncoder().encode(raw).byteLength > MAX_DOCUMENT_BYTES)
    throw Error('native.labels-draft-too-large');
  let labels: unknown;
  try {
    labels = JSON.parse(raw);
  } catch {
    throw Error('native.labels-draft-invalid');
  }
  if (
    !Array.isArray(labels) ||
    labels.length > nativeLabelLimit ||
    labels.some((v) => typeof v !== 'string' || v.length > 10000)
  )
    throw Error('native.labels-draft-invalid');
  return labels;
}
export function serializeNativeLabels(labels: readonly string[]): string {
  const raw = JSON.stringify(labels);
  parseNativeLabels(raw);
  return raw;
}
/** Blank separator lines are ignored; nonempty labels retain whitespace, duplicates and order. */
export function nativeLabelsFromLines(text: string, maxItems = nativeLabelLimit): string {
  const labels = text.split(/\r\n|\r|\n/).filter((label) => label !== '');
  if (labels.length > Math.min(nativeLabelLimit, maxItems))
    throw Error('native.labels-draft-invalid');
  return serializeNativeLabels(labels);
}
export function changeNativeLabel(raw: string, index: number, value: string): string {
  const labels = parseNativeLabels(raw);
  if (!Number.isInteger(index) || index < 0 || index >= labels.length)
    throw Error('native.label-position-invalid');
  labels[index] = value;
  return serializeNativeLabels(labels);
}
export function moveNativeLabel(raw: string, index: number, direction: -1 | 1): string {
  const labels = parseNativeLabels(raw),
    target = index + direction;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= labels.length ||
    target < 0 ||
    target >= labels.length
  )
    throw Error('native.label-position-invalid');
  [labels[index], labels[target]] = [labels[target]!, labels[index]!];
  return serializeNativeLabels(labels);
}
export function removeNativeLabel(raw: string, index: number): string {
  const labels = parseNativeLabels(raw);
  if (!Number.isInteger(index) || index < 0 || index >= labels.length)
    throw Error('native.label-position-invalid');
  labels.splice(index, 1);
  return serializeNativeLabels(labels);
}
export function addNativeLabel(raw: string): string {
  return serializeNativeLabels([...parseNativeLabels(raw), '']);
}
/** Old archive text is never reparsed into a different label array. */
export function nativeLabelsForCommand(
  values: Record<string, string>,
  before: Record<string, string>,
  field: string,
  legacyField: string,
  current: readonly string[],
): string[] {
  if (values[legacyField] !== before[legacyField])
    throw Error('native.labels-draft-upgrade-required');
  if (values[field] !== undefined) return parseNativeLabels(values[field]);
  return [...current];
}
