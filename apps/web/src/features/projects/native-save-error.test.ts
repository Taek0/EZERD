import { describe, expect, it } from 'vitest';
import { nativeSaveRejectionMessage } from './native-save-error.js';

describe('native save rejection explanation', () => {
  it('shows the size limit, field and support identifiers', () => {
    const message = nativeSaveRejectionMessage({
      code: 'document.invalid',
      requestId: 'req-123',
      issues: [{ code: 'document.size-limit', path: 'commands.0.patch' }],
    });
    expect(message).toContain('허용 크기를 초과');
    expect(message).toContain('commands.0.patch');
    expect(message).toContain('document.invalid');
    expect(message).toContain('req-123');
  });
  it('explains retired identity failures and handles missing diagnostics', () => {
    expect(nativeSaveRejectionMessage({ code: 'sync.identity-retired' })).toContain(
      '이전에 삭제된 항목',
    );
    expect(nativeSaveRejectionMessage()).toContain('저장이 거부');
  });
});
