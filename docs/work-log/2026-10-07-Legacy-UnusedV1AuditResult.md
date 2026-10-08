# 미사용 v1 코드 조사 결과

## 범위와 기준

- [조사 계획](../planning/2026-10-07-Legacy-UnusedV1AuditPlan.md).
- 사용자 방침: 앞으로 v1 프로젝트를 열거나 편집하지 않는다. 이번 요청은 미사용 코드 조사이며 실제 삭제는 수행하지 않았다.
- Git 추적 중인 TS/TSX/JS/MJS/CJS를 대상으로 TypeScript AST의 정적 import/export, 문자열 리터럴 dynamic import/require를 조사했다. 웹 main.tsx와 서버 main.ts부터 파일 도달성을 확인하고, 공유 패키지 barrel export도 추적했다.
- 미사용 export 후보는 다른 운영 소스뿐 아니라 선언 파일 내부 사용, 테스트, 스크립트의 이름·경로 참조도 확인했다. 테스트 전용 기준 구현과 Native 공통 코드는 제외했다.
- 줄 수는 공백·주석을 포함한 실제 파일 줄 수이다. 파일 일부는 선언 시작부터 끝까지 계산했다. 테스트 줄 수는 구현 합계와 분리했다.
- 정적 조사이므로 계산된 동적 경로, 외부 소비자, 런타임 실행률까지 증명하지 않는다. 패키지 export 삭제는 삭제 단계에서 타입 검사·관련 테스트·빌드로 검증해야 한다.

## 1차 후보: 파일 전체 2개, 구현 193줄

| 파일 | 구현 줄 수 | 근거 | 함께 정리할 테스트 |
| --- | ---: | --- | --- |
| apps/web/src/features/collaboration/document-history.ts | 143 | DocumentHistory, documentEditGroup, mergeHistoryViewports는 document-history.test.ts만 참조한다. 앱 진입점에서 도달하지 않는다. 제네릭 히스토리 클래스와 v1 문서 그룹/viewport 처리가 묶인 미사용 모듈이다. | document-history.test.ts 70줄 |
| apps/web/src/features/tables/ddl-diagnostics.ts | 50 | v1 DesignDocument의 DDL 진단 대상 위치를 찾는 diagnosticTarget은 ddl-diagnostics.test.ts만 참조한다. 앱 진입점에서 도달하지 않는다. | ddl-diagnostics.test.ts 81줄 |

두 모듈과 전용 테스트를 함께 제거하면 4개 파일, 총 344줄이다. translation 모듈이나 공유 모델은 이 파일들의 의존성이었다는 이유로 함께 삭제하지 않는다.

## 2차 후보: 기존 파일의 미사용 선언 6개, 구현 68줄

| 위치 | 선언 | 줄 수 | 확인한 참조 |
| --- | --- | ---: | --- |
| apps/web/src/features/canvas/Canvas.tsx:2752 | referencedDomainTables | 25 | Canvas.test.ts만 호출. 같은 파일의 렌더링에서도 사용하지 않는다. |
| apps/web/src/features/canvas/canvas-state.ts:5 | relationTargets | 3 | canvas-state.test.ts만 호출. cardSize, connectedRelations와 파일을 함께 삭제하지 않는다. |
| apps/web/src/features/relations/TableRelations.tsx:50 | applyRouteBend | 21 | table-relations-sync.test.ts만 호출. 실제 applyRoutePatch 경로는 보존한다. |
| apps/web/src/features/tables/TableEditor.tsx:88 | physicalTypes | 1 | postgresTypeNames의 별칭이며 다른 코드·테스트·스크립트 참조가 없다. 원본 postgresTypeNames는 삭제 대상이 아니다. |
| apps/web/src/features/tables/TableEditor.tsx:123 | parseMetadata | 14 | TableEditor.test.ts만 호출. 실제 편집기 내부 호출이 없다. |
| packages/contracts/src/workspace.ts:272 | saveDocumentSchema | 4 | document.test.ts만 사용. designDocumentSchema와 projectDocumentSchema는 보존한다. barrel로 공개되어 있으므로 삭제 시 패키지 빌드 확인이 필요하다. |

해당 테스트 파일은 다른 동작도 검사하므로 파일 전체 삭제가 아니라 관련 import·테스트 항목만 정리한다. relationTargets와 parseMetadata 자체는 범용 함수지만 현재 v1 UI 모듈에 남은 미사용 선언으로 분류했다.

1·2차 후보의 구현 합계는 **261줄**이다. 독립 전용 테스트 151줄을 포함하면 **412줄**, 혼합 테스트의 정리분과 정리 후 불필요해지는 import는 별도이다. 이는 첫 제거 후보의 규모이며 레포 전체 v1 코드량이 아니다.

## 우선 삭제 대상에서 제외

- Canvas, TableEditor, ProjectSyncRuntime, 서버 SyncService/SyncController, McpDocumentService: App 또는 서버 모듈에서 여전히 연결돼 있다. 사용자 방침상 향후 제거할 수 있지만 현재 미사용 코드로 분류하지 않는다.
- apps/web/src/features/relations/relation-routing.ts: NativeERDCanvas와 native-route-edit에서 재사용한다.
- apps/web/src/features/domains/domain-relations.ts: native-domain-lines에서 재사용한다.
- packages/model/src/sync.ts: SyncDocument가 DesignDocument와 NativeDesignDocument를 함께 지원한다. 파일 전체를 v1 전용으로 취급할 수 없다.
- prepare-table-relations.reference.ts, relation-routing.reference.ts: 의도적으로 보존한 테스트용 기준 구현이다. prepare-table-relations, obstacle-queries, relation-pruning 회귀 검증이 실제로 사용한다. 운영 import가 없다는 이유로 제거하지 않는다.
- RenameDialog.tsx: 도달하지 않고 참조도 없지만 v1 전용이라는 근거가 부족한 공통 UI다. 별도 미사용 UI 정리 대상으로 분류한다.
- canApplyOperation, canApplyInverse, retainPendingOperations, mergeCandidateOntoDocument 등: 운영 호출이 없는 후보가 있으나 공통 동기화 계층이며 일부는 Native 회귀 테스트가 사용한다. 이번 v1 우선 정리 합계에서 제외한다.
- rebaseAutosaveDraft, autosaveDelay, mergePersonalState: 다른 파일의 운영 참조가 없더라도 같은 파일 내부에서 실제 호출되므로 제외한다.
- v1 import/upgrade 및 Native의 legacy 원문 보존: v1 열기·편집 중단과 별도로 검토한다. Native 문서 안에 보존된 legacy 타입·표현식까지 삭제해도 된다는 의미로 해석하지 않는다.

## 권장 진행 단위

1. 독립 모듈 2개와 전용 테스트 2개를 제거하고 관련 타입 검사·빌드를 확인한다.
2. 미사용 선언 6개와 관련 테스트 항목을 제거하고 기존 파일의 나머지 테스트를 실행한다.
3. 별도 작업으로 v1 열기·편집 진입을 중단하고 도달성을 다시 분석한다. 이때 새로 미사용이 되는 대형 편집기·서버 경로와 Native 공유 의존성을 분리한다.

이번 조사에서는 제품 소스, 테스트, DB를 변경하지 않았다. 코드 실행 검증은 수행하지 않았고 import 도달성 및 참조 분석을 수행했다. docs/EZERD.txt는 수정하지 않았다.
