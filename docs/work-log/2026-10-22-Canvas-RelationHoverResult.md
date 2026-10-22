# 관계 hover 렌더링 반복 작업 축소 결과

[구현 계획](../planning/2026-10-22-Canvas-InteractivePerformancePlan.md)의 2번을 구현했다.

- `NativeTableLines`에 기본 shallow 비교를 사용하는 React memo 경계를 적용했다. Scene의 기존 안정된 `setHoveredRelationId`와 관계·문서 props를 그대로 사용하므로 hover로 Scene이 갱신되어도 SVG는 다시 렌더링하지 않는다.
- 테이블·컬럼 배열과 표시 모드별로 이름 Map을 만들고, 관계 배열과 이름 Map별로 tooltip·cardinality·label width를 재사용한다. 컬럼 조회는 table ID와 column ID를 함께 사용하며 누락된 값의 ID fallback을 보존한다.
- 선택 및 콜백 변경은 SVG에 반영하지만 콘텐츠 파생값은 재사용한다. 관계·이름·모드 변경은 파생값을 갱신하고, 언어 변경은 기존 i18n 구독을 통해 접근성 라벨에 반영된다. 캐시는 컴포넌트별 최신 useMemo 값으로 제한된다.
- Scene의 relationColumns 계산과 Set 참조 재사용, 행 highlight, 이벤트와 접근성 속성은 변경하지 않았다.

## 검증

실제 jsdom React root에서 hooks를 모킹하지 않고 검증했다.

- 5회 pointer 진입/이탈과 focus 진입/이탈 동안 행 highlight는 변경되지만 SVG path 읽기와 tooltip description 읽기는 최초 렌더 횟수에서 증가하지 않는다. SVG DOM 참조 및 직렬화 결과도 같다.
- 관계 선택은 aria-pressed와 행 highlight를 갱신하고 tooltip을 재생성하지 않는다. 기존 Scene 검사는 선택 전환 중 동일 highlight Set 참조 재사용을 검증한다.
- 같은 컬럼을 참조하는 관계 100개에서 컬럼 이름 getter는 1회만 읽힌다. 기존 구현은 각 관계의 endpoint마다 배열 find와 이름 조회를 수행했다.
- 문서 이름·모드·관계 라벨/설명·언어 변경, 최신 선택/hover 콜백, click 전파 차단, Enter/Space/Escape 및 누락 endpoint fallback을 검사했다.
- `pnpm.cmd exec vitest run apps/web/src/features/projects/NativeTableLines.test.ts apps/web/src/features/projects/NativeTableLines.lifecycle.test.ts apps/web/src/features/projects/NativeCanvasScene.test.ts`: 3개 파일 30개 테스트 통과.
- 변경 파일만 Prettier를 적용했다. 전체 포맷과 통합 검증은 루트 작업에서 수행한다.
- 웹 타입 검사는 병렬 작업 중 `NativeERDCanvas.lifecycle.test.ts:203`의 requestedView optional 타입 오류로 실패했으며 해당 소유자에게 전달했다. 이 변경 파일의 타입 오류는 보고되지 않았다.

브라우저 프레임 시간을 측정하지 않았으므로 FPS나 백분율 개선을 주장하지 않는다.
