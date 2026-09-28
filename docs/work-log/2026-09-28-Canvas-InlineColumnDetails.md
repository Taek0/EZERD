# 캔버스 사이드바 컬럼 상세 개선 결과

- 선택한 컬럼 바로 다음 목록 항목에 상세 편집기를 배치했다. 다른 컬럼을 선택하면 해당 위치로 바뀌고 같은 컬럼을 다시 클릭하면 닫힌다.
- 공통 `PanelListDetail`에 180ms 높이·투명도 애니메이션을 추가했다. 닫는 동안만 기존 편집기를 유지하고 닫힌 편집기는 마운트하지 않는다. 모션 감소 설정에서는 즉시 전환한다.
- 목록은 `ul > li` 구조를 유지하고 상세 영역을 드래그 가능한 행에서 분리했다. 컬럼 ID로 묶인 행과 상세는 순서를 바꿔도 입력 상태를 유지한다. 닫히는 영역은 `inert`로 추가 입력을 막는다.
- 선택 행과 상세 박스의 중복 색상 규칙을 정리하고 공통 파란색 배경·테두리 토큰을 적용했다.
- 펼침 버튼에 `aria-expanded`와 열린 상세 영역의 `aria-controls`를 연결했다. 기존 읽기 전용 fieldset과 변경 방어 로직을 유지했다.
- 기존 브라우저 스모크 스크립트는 삭제된 애니메이션 이름 검사 대신 상세 위치·배경색·순서 변경 후 위치·닫기 동작을 검사하도록 갱신했다.

## 검증

- `pnpm --filter @ezerd/web typecheck` 통과.
- `node node_modules/vitest/vitest.mjs run apps/web/src/features/tables/TableEditor.test.ts apps/web/src/features/tables/table-refinement.test.ts apps/web/src/components/ui/ui.test.ts`: 3개 파일, 21개 테스트 통과.
- `pnpm exec vitest`가 실행 파일을 찾지 못해 설치된 Vitest 진입 파일을 Node로 실행했다.
- `pnpm format` 적용 및 `pnpm format:check` 통과.
- 브라우저에서 실제 애니메이션과 화면을 확인하는 검증은 수행하지 않았다. 루트 의존성에 Playwright가 없어 브라우저 스모크 스크립트도 실행하지 않았다.
