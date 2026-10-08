# v1 편집기 전용 구현·QA 제거

- [계획](../planning/2026-10-07-Legacy-FrontendRetirementPlan.md)의 단위 1 완료.
- main.tsx의 로컬 import/export 및 CSS import 그래프로 보호 목록을 만든 뒤 전체 레포의 코드·테스트·QA 소비자를 확인했다. 문자열로 HTML에 삽입되는 /src/ import도 조사했다.
- 삭제 전 앱에서 도달한 소스·스타일 151개의 SHA-256을 비교했고, 삭제 후 모두 존재하며 내용이 동일함을 확인했다. 공유 packages와 서버 구현은 변경하지 않았다.

## 제거 범위

- Canvas, TableEditor, TableRelationsSvg, ForeignKeyDialog, EnumManager, LegacyDatabaseEditorNotice와 전용 상태·뷰·기본값·키·타입 선택·도메인 편집 유틸리티 및 전용 CSS/번역: 25개 구현 파일.
- 폐기한 화면·함수만 검증하던 전용 테스트: 17개 파일.
- v1 Canvas/TableEditor를 직접 띄우던 QA 스크립트: browser-canvas-feedback, browser-delete-shortcut, browser-density-editor, browser-direct-editing, browser-domain-inline, browser-domain-view-refinement, browser-domain-workflow, browser-routing-refinement, browser-table-feedback, browser-table-header, browser-table-refinement, browser-views-relations, browser-table-workflow의 smoke.mjs 파일 13개.
- 총 55개 파일을 삭제했다. README·패키지 실행 명령에서 삭제된 스크립트의 실행 참조는 발견되지 않았다. 과거 작업 기록은 당시 기록으로 보존한다.

## 보존한 검증과 현재 구현

| 기능 | 조치 |
| --- | --- |
| 공통 관계선 | TableEditor 테스트 안의 인접 카드·자기 참조 2개 검증을 relation-routing.test.ts로 이동했다. table-geometry.test.ts는 관계선 구현을 직접 참조한다. |
| 카드 크기 | table-geometry, table-refinement의 순수 모델 크기 검증을 유지했다. NativeCanvasTableRows의 기존 모델과 Native 표시값 비교도 유지했다. |
| 공유/개인 상태 격리 | combined-route-edit.test.ts를 upsertRelationLayout, extractPersonalState, mergeStoredPersonalState 직접 사용으로 변경했다. 변경 경로 분리·원격 데이터 보존 검증은 남겼다. |
| 경로 최적화 기준 | prepare-table-relations 및 reference, relation-routing.reference는 obstacle-queries·relation-pruning의 회귀 기준으로 여전히 사용하므로 유지했다. prepare-table-relations 테스트에서는 폐기된 SVG 컴포넌트 전용 렌더 검사만 제거했다. |
| Native 조작 | NativeERDCanvas의 선택/드래그, NativeCanvasInlineCell의 입력/ACK, NativeDomainEditor, native-route-edit, native-canvas-selection, NativeCanvasTableRows, native-canvas-png의 기존 테스트를 유지했다. 기존 v1 브라우저 스크립트와 동일한 브라우저 QA를 새로 실행했다는 의미는 아니다. |

- Native가 재사용하는 canvas-selection, selection-frame, canvas-tool-shortcuts, canvas-wheel, table-clipboard, inspector-state, relation-routing, obstacle-queries, domain-relations, DomainDescription, DomainColorPicker, column-type-display를 보호했다.
- 앱 그래프 회귀 테스트에 위 공유 모듈의 연결 확인과 누락된 상대 JS import 검출을 추가했다. 도달하지 않는 것만 확인하다 삭제된 의존성을 놓치는 경우를 방지한다.
- 공유 번역·공통 전역 CSS·Native가 직접 import하는 enum-manager.css는 보존했다.

## 검증

- pnpm format, pnpm typecheck, pnpm test, git diff --check 통과.
- 전체 테스트: 210개 파일/2,689개 테스트 통과, 27개 파일/506개 테스트 건너뜀.
- 다음 동기화·히스토리 정리 이후 최종 format:check와 전체 빌드를 확인한다. 브라우저·DB 통합 환경을 새로 실행하지 않았다.
