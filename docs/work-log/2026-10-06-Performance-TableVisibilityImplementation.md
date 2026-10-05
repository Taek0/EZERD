# Native 테이블 카드 표시 최적화 구현

- 계획: [TableVisibilityImplementation](../planning/2026-10-06-Performance-TableVisibilityImplementation.md).
- 검증 후보를 제품 NativeERDCanvas.css에 옮겼다. 제품 변경은 CSS 18줄이며 Native 테이블 카드에만 content-visibility:auto를 적용한다.
- 선택/preview/focus/active 및 입력/dirty 후손이 있는 카드는 visible로 유지한다. NodeLayout의 치수와 원본 UI/모션/저장 로직은 그대로 사용한다.
- content-visibility와 :has 선택자를 함께 지원할 때만 켠다. 예외를 지원하지 않으면 기존 렌더링으로 동작한다.
- pnpm format/format:check 통과. NativeCanvasInlineCell/Scene/TableRows/InputForm/route-edit 5개 파일·79개 테스트 통과.
- 일반 제품 pnpm build 통과. 기존 bundle 크기 경고는 남아 있다.
- Lab 대조군을 제품 CSS의 opt-out 방식으로 바꾸어 후속 제품 경로 실측을 수행한다. main/원격 브랜치에는 아직 반영하지 않는다.
