import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { NativeProjectActions } from './NativeProjectActions.js';
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (text: string) => text }),
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocked: () => false }));
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
describe('structural model export controls', () => {
  it('disables DDL with an explanation while preserving JSON and PNG export', () => {
    const ddl = vi.fn(async () => {});
    const tree = NativeProjectActions({
      userId: 'user',
      projectId: 'project',
      ddlDisabled: true,
      onExportDDL: ddl,
      onExportProject: async () => {},
      png: { run: async () => {}, disabled: false, busy: false },
    });
    const items = nodes(tree).find((node) => node.props.items)!.props.items as {
      id: string;
      label: string;
      disabled: boolean;
      onAction: () => void;
    }[];
    const item = items.find((item) => item.id === 'ddl-export')!;
    expect(item.disabled).toBe(true);
    expect(item.label).toBe('DDL 내보내기 · DB 선택 필요');
    item.onAction();
    expect(ddl).not.toHaveBeenCalled();
    expect(items.filter((item) => item.id !== 'ddl-export').every((item) => !item.disabled)).toBe(
      true,
    );
  });
});
