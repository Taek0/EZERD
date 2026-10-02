# Native ERD와 공유 캔버스 계획

- 작성일: 2026-10-02
- 기준 HEAD: `2709412`, 승인 C4 확장 후속 독립 단위.
- 사양: [DB capability 명세](2026-10-01-Database-CapabilitySpecification.md), [지원표](2026-10-01-Database-TypeFeatureMatrix.md).
- 결과: [Native canvas 작업 기록](../work-log/2026-10-02-Database-NativeCanvas.md).

## 목적과 범위

1. v2 원본을 v1 타입으로 투영하지 않고 테이블/컬럼/키/FK를 ERD로 표시한다. native 타입·namespace/default/generation을 그대로 소비하고 기존 상세 속성 선택에 연결한다.
2. generic common canvas의 노드 배치/참조/메모 helper와 경로 geometry를 재사용한다. 드래그·키보드 입력은 내구성 있는 draft와 기존 native pending/ACK 경로로 저장한다.
3. 공유 화면(`overview`, `__tables__`, domain) 명령과 개인 combined view/viewport 저장을 분리한다. viewport는 공유 sync가 제거하는 개인 상태라는 기존 정책을 유지한다. 개인 REST JSON optimistic version 저장의 미확인 요청도 보관·조회 확인하며 문맥 변경 시 자동 재해석하지 않는다.
4. shared domain lifecycle와 table domain ownership은 main이 제공하는 native-safe model helper를 소비한다. v1 helper로 강제 cast하거나 보호 정책을 우회하지 않는다.

## 경계

- 변경: `NativeProjectView.tsx`의 content 영역, 새 `NativeERDCanvas.tsx/css/test`, `native-editor-command.ts/tests`, `mcp-native-document.service.ts` 및 command tests, 이 계획과 결과 문서.
- 상단바/공유 메뉴 props, App.tsx, 기존 Canvas.tsx, sync/NativeSyncService/model/index 파일은 변경하지 않는다.
- coverage false를 유지하며 신규 물리 타입·기능을 활성화하지 않는다.
- node ID 160, view ID trim, 좌표·크기·zoom 범위를 구조 계약/generic helper로 검증한다.

## 검증과 인계

- 변경 파일 Prettier, 관련 Vitest, 최신 소스 참조 typecheck만 수행한다. fullcheck/commit 및 브라우저·실제 HTTP/MCP QA는 main이 통합한다.
- native raw 보존, FK endpoints, 배치/참조/메모 명령, 개인/공유 차단, draft/before 및 늦은 ACK·readonly·DB revision 보호를 검증한다.
- 작은 ERD 소비 단위의 실제 연결과 미구현 범위를 구분해 ready를 보고한다.

## 후속 실제 브라우저 QA 수정

- 사용자 피드백: MySQL 형식 UI의 namespace/options 원시 JSON을 스키마·엔진 등 의미 있는 현재 값으로 표시한다. 개인 저장 미지원 안내는 공유 캔버스를 사용하도록 안내한다.
- 변경 없는 `NativeEditorForm`은 저장 버튼과 submit 경로를 비활성화한다.
- 로컬 카메라/개인 상태는 공유 물리 문서 export blocker에서 제외하고 공유 문서 입력·저장 실패는 계속 차단한다. 관련 표시와 blocker 범위 회귀를 targeted tests로 확인한다.
