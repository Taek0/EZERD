# 편집기 반응형 셸 적용

- `responsive-shell.css`와 App import를 추가했다. 편집기 전용으로 기존 CSS보다 구체적인 선택자를 사용하므로 main.tsx의 기존 CSS import 순서와 관계없이 적용된다.
- CSS 뷰포트 기반 clamp로 헤더 높이 52–76px, 버튼 높이 30–36px, 도구 글자 13–14px, 프로젝트 제목 18–22px을 적용했다. 화면 높이 700px 이하에서는 세로 여백을 추가로 줄인다.
- 헤더·프로젝트 행·도구 모음에 줄바꿈을 적용했다. 동적 뷰포트 높이와 flex 배치로 캔버스가 남은 공간을 사용하며 최소 높이는 240–400px 범위로 조절된다.
- 갤러리, 카드 글자, 문서 줌, DPR/OS 판별은 변경하지 않았다.
- `pnpm format`, `pnpm format:check` 통과. `node node_modules/vite/bin/vite.js build`를 apps/web에서 실행해 번들 생성 통과(기존 큰 JS 청크 경고).
- 웹 전체 빌드는 병행 수정 중인 Canvas.tsx의 `shouldStackInspector` 미정의 타입 오류로 미완료였다. 통합 작업에서 패널 수정 완료 후 재검증한다.
- 실제 화면 크기별 시각 검증은 부모 작업에서 통합 수행한다.
