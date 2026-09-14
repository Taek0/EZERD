import { describe, expect, it } from 'vitest';
import { canExportPhysical, isVisibleInView } from './index.js';

describe('unified logical and physical model', () => {
  it('shows physical-only columns in physical and combined views', () => {
    expect(isVisibleInView('physical', 'logical')).toBe(false);
    expect(isVisibleInView('physical', 'physical')).toBe(true);
    expect(isVisibleInView('physical', 'both')).toBe(true);
  });
  it('honors the parent table scope even for a shared column', () => {
    expect(isVisibleInView('both', 'physical', 'logical')).toBe(false);
    expect(canExportPhysical('both', 'logical')).toBe(false);
  });
  it('excludes logical-only objects from physical export', () => {
    expect(canExportPhysical('logical')).toBe(false);
    expect(canExportPhysical('both')).toBe(true);
  });
});
