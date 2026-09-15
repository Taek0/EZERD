import { describe, expect, it } from 'vitest';
import { addDomain, createEmptyDocument, updateDomain } from '@ezerd/model';
import { autosaveDelay, rebaseAutosaveDraft } from './App.js';

describe('autosave UI draft preservation', () => {
  it('debounces text, suppresses IME composition, and commits discrete actions immediately', () => {
    expect(autosaveDelay(true, false)).toBe(500);
    expect(autosaveDelay(true, true)).toBeNull();
    expect(autosaveDelay(false, false)).toBe(0);
  });

  it('keeps an uncommitted text field while accepting an independent remote field', () => {
    const base = addDomain(
      createEmptyDocument(),
      { id: 'orders', name: '주문', description: '' },
      { x: 10, y: 20 },
    );
    const draft = updateDomain(base, 'orders', { name: '주문 관리' });
    const server = updateDomain(base, 'orders', { color: '#445566' });

    const rebased = rebaseAutosaveDraft(base, draft, server);

    expect(rebased.domains[0]).toMatchObject({ name: '주문 관리', color: '#445566' });
  });

  it('keeps the local field value when a remote snapshot changed that same field before debounce', () => {
    const base = addDomain(
      createEmptyDocument(),
      { id: 'orders', name: '주문', description: '' },
      { x: 10, y: 20 },
    );
    const draft = updateDomain(base, 'orders', { name: '내 주문' });
    const server = updateDomain(base, 'orders', { name: '팀 주문' });

    expect(rebaseAutosaveDraft(base, draft, server).domains[0]?.name).toBe('내 주문');
  });
});
