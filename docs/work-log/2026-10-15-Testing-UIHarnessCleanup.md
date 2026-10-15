# UI 테스트 보조 코드 정리 기록

## 공통 계약

- shared/testing에 수동 Node 훅 driver와 React element 순회를 추가했다. 제품 런타임에서 import하지 않는다.
- 상태/함수형 업데이트/ref, memo/callback 의존성, 명시적 effect commit/cleanup, 실제 React fallback과 element 순회 계약 6개 테스트 및 웹 타입 검사 통과.
- 이 helper는 실제 React renderer나 동시 렌더링/DOM/레이아웃 모델이 아니다. 해당 의미를 검증하는 특수 실행기는 유지한다.
- 기존 안전성 테스트 단언은 제거하지 않고 같은 구조의 반복 보조 코드부터 이 helper로 통합한다.

## 공통 실행기로 이관

- 15개 테스트 파일의 중복 훅 구현을 공통 helper로 이관했다. 기존 152개 시나리오와 463개 expect 호출의 AST가 유지됨을 확인했다.
- 공통 helper 계약까지 포함한 집중 검사 159개와 웹 타입 검사가 통과했다.
- 고급 편집/ENUM의 명시적 재렌더 신호는 onStateChange로 보존했다. i18n snapshot과 갤러리 imperative ref의 특수 모킹은 각 테스트에 명시적으로 남겼다.
- 같은 의미인 element 순회와 state 생성도 공유했다. 렌더 중단·layout/passive 분리·드래그 DOM 모델을 다루는 특수 실행기는 이번 이관에서 제외했다.

## 실제 React DOM 전환

- NativePrimaryKeyControl 테스트의 React 훅 모킹/수동 element 순회를 제거했다. React createRoot/act와 실제 checkbox DOM click으로 같은 memo 재사용·최신 onSave/sequence·busy 차단을 검증한다.
- ACK 대기 중 checkbox 비활성화와 중복 클릭 방지도 같은 시나리오에서 확인한다. PK 규칙 자체는 기존 모델 테스트를 유지하고 이 UI 테스트에서는 plan 의존성만 mock한다.
- jsdom 30.1.2를 개발 의존성으로 고정했다. 이 파일만 jsdom 환경을 사용하며 기본 테스트 환경은 node다. 제품 런타임 의존성은 추가하지 않았다.
- 전환된 테스트와 웹 타입 검사 통과. 실제 브라우저 레이아웃/성능 검증을 jsdom으로 대체한 것은 아니다.

## 최종 검증 및 범위

- `pnpm check` 통과: Prettier, 전체 타입 검사, 테스트, 제품 빌드 완료.
- 테스트 2,935개 통과 / 495개 기존 skip, 파일 255개 통과 / 26개 skip. 실행 시간 20.92초. 기존 2,928개에 공통 helper 계약 7개가 추가됐으며 기존 시나리오를 삭제하지 않았다.
- `EZERD_PANEL_INTERACTIONS=1`, `EZERD_PANEL_DETAIL=1` 조건의 `pnpm perf:build` 통과. 제품 및 계측 빌드에 기존 청크 크기 경고는 남아 있다.
- 시작 커밋 b059d3d 대비 테스트·보조 코드 19개 파일에서 418줄 추가 / 790줄 제거, 순감 372줄이다. 문서와 개발 의존성 lockfile 변경은 이 수치에서 제외했다.
- 제품 구현과 서버·모델·계약 안전성 테스트는 변경하지 않았다. 별도 의미를 가진 수동 실행기와 아직 이관하지 않은 모킹은 유지했으므로 모든 React 모킹을 제거한 작업은 아니다.
- 작업은 codex/performance-lab 격리 워크트리에만 커밋했다. 로컬 main 변경 및 원격 push는 하지 않았다.
- 원시 검증 로그: artifacts/performance/2026-10-15-ui-harness-check.log 및 2026-10-15-ui-harness-perf-build.log (Git 제외).
