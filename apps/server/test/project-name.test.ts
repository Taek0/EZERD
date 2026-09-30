import { describe, expect, it } from 'vitest';
import { nextAutomaticProjectName } from '../src/workspace/project-name.js';

describe('automatic project names', () => {
  it('uses the base name when no automatic names exist', () => {
    expect(nextAutomaticProjectName(['다른 설계', '새 프로젝트 수정'])).toBe('새 프로젝트');
  });
  it('increments beyond the largest exact suffix without filling gaps', () => {
    expect(
      nextAutomaticProjectName(['새 프로젝트', '새 프로젝트 1', '새 프로젝트 8', '새 프로젝트 03']),
    ).toBe('새 프로젝트 9');
    expect(nextAutomaticProjectName(['새 프로젝트 8'])).toBe('새 프로젝트 9');
  });
  it('handles a manually entered suffix larger than safe integer precision', () => {
    expect(nextAutomaticProjectName(['새 프로젝트 9007199254740993'])).toBe(
      '새 프로젝트 9007199254740994',
    );
  });
});
