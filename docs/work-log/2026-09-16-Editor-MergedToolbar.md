# 편집기 통합 도구 헤더 구현

- App의 프로젝트 헤더를 제목·캔버스 도구·저장 상태의 세 그룹으로 구성했다. 제목은 긴 경우 말줄임하고 전체 이름을 title로 제공한다.
- Canvas는 선택·뷰·내보내기 상태를 그대로 소유하며 toolbarHost가 있으면 React portal로 도구를 표시한다. 독립 Canvas 및 기존 테스트는 기존 도구 위치를 유지한다.
- 포털에서 전달되는 키보드 이벤트가 캔버스 선택 객체 삭제로 이어지지 않도록 DOM 포함 여부와 도구 영역을 검사한다.
- 헤더 버튼을 높이 30px, 글자 13px, 굵기 650으로 통일하고 파란 회색 뉴모피즘 배경·경계·hover·focus-visible·확장 상태를 보강했다.
- 헤더와 도구 그룹은 줄바꿈을 허용하며 좁은 화면에서는 그룹을 쌓는다.
- `pnpm format`, `pnpm format:check`, `pnpm --filter @ezerd/web typecheck` 통과. 브라우저 검증은 상위 작업에서 이어서 수행한다.
- `pnpm test -- apps/web/src/Canvas.test.ts apps/web/src/autosave-ui.test.ts`: 2개 파일, 8개 테스트 통과.
- 브라우저 QA에서 inspector.css의 더 구체적인 선택자가 도구 버튼을 14px/약 34px로 유지하는 문제를 확인했다. 통합 헤더의 직접 도구 버튼 선택자를 강화하고 패딩을 4px/8px로 조정했으며 속성 토글은 30px 정사각형으로 맞췄다.
