# 공유 모델·계약 v1 의존성 조사 결과

- [계획](../planning/2026-10-07-Legacy-SharedModelAuditPlan.md)에 따른 조사 단위다. 제품 코드·DB는 변경하지 않았다.
- packages/model/src 및 packages/contracts/src의 루트 모듈과 혼합 canvas 모듈 2개의 exported 선언 **336개**를 조사했다. TypeScript checker로 barrel/alias를 따라 실제 심볼 참조를 확인하고 같은 파일 내부 참조·운영 코드·테스트·스크립트를 구분했다.
- QA의 문자열 HTML 및 ../packages/*/dist 직접 import는 소스 심볼 분석만으로 놓칠 수 있어 우선 후보와 관련 함수는 rg로 교차 확인했다. 단순 키워드 hit 수나 파일 전체 줄 수를 삭제 가능 규모로 사용하지 않았다.
- 아래 줄 수는 선언 시작부터 끝까지의 실제 줄 수이며 주석·빈 줄·후속 import 정리분은 제외한다. 외부 소비자나 계산된 동적 접근까지 없다고 증명하는 것은 아니다. 실제 삭제 단계에서는 타입 검사·관련 테스트·빌드가 필요하다.

## 결론

1. **독립 소비자가 없는 11개 선언, 46줄**은 첫 삭제 단위 후보로 확정할 수 있다. 서로만 참조하는 schema/type 쌍은 함께 제거한다.
2. 클립보드에는 **Native 저장소 함수와 운영 미사용 v1 복사/붙여넣기 구현이 혼재**한다. 저장소를 분리한 뒤 v1 부분을 정리하는 것이 다음으로 안전하다.
3. document.ts와 sync.ts 전체는 삭제할 수 없다. Native 타입·생성자·프로토콜이 v1 정의를 직접 기반으로 사용한다.
4. v1 migration은 오래된 파일뿐 아니라 **Native 파일의 legacy 원문 증거 검증에도 사용**된다. 가져오기가 v2로 통합됐다는 이유로 제거하면 안 된다.

## 1차 삭제 후보: 독립 소비자 없음

| 위치 | 제거 단위 | 선언 줄 수 | 참조 확인 |
| --- | --- | ---: | --- |
| packages/contracts/src/relational.ts:43 | physicalTypePatchSchema | 1 | 정의 외 운영·테스트·스크립트 참조 없음 |
| packages/model/src/document.ts:911 | removeKey | 3 | 정의 외 참조 없음 |
| packages/model/src/document.ts:928 | removeTableRelation | 14 | 정의 외 참조 없음 |
| packages/model/src/sync.ts:542 | canApplyOperation | 6 | 정의 외 참조 없음. findFieldVersionConflicts는 유지 |
| packages/model/src/table-geometry.ts:86 | effectiveCardSize | 9 | 정의 외 참조 없음. tableCardMetrics/tableCardSize는 유지 |
| packages/contracts/src/sync.ts:108 | syncHistoryEntrySchema + SyncHistoryEntry | 6 | 타입 별칭만 해당 schema를 참조. 두 선언의 외부 소비자 없음 |
| packages/contracts/src/sync.ts:114 | syncFieldVersionSchema + SyncFieldVersion | 2 | 타입 별칭만 해당 schema를 참조. 두 선언의 외부 소비자 없음 |
| packages/contracts/src/workspace.ts:268 | projectDocumentSchema + ProjectDocument | 5 | 타입 별칭만 해당 schema를 참조. 두 선언의 외부 소비자 없음 |

합계는 8개 제거 단위/11개 선언/46줄이다. schema/type 쌍 내부 참조까지 전혀 없다는 뜻은 아니다. projectSchema, storedDesignDocumentSchema, syncEventSchema 등 이 선언들이 사용하던 기반은 다른 소비자가 있으므로 함께 제거하지 않는다.

## 2차 후보: 분리 및 테스트 정리가 필요

| 영역 | 운영 미사용 후보 | 유지할 요소 및 주의점 |
| --- | --- | --- |
| apps/web/src/features/canvas/table-clipboard.ts | copyTables(48줄), parseTableClipboard(54줄), pasteTables(159줄), localTablePasteFallback(1줄), acknowledgeSystemTableClipboard(3줄) | 합계 265줄의 선언은 해당 전용 테스트만 참조한다. NativeERDCanvas는 rememberTableClipboard/readLocalTableClipboard를 실제 호출하며 remember에 true 인자도 전달한다. 공유 메모리와 호출 계약을 먼저 분리하고 테스트 파일 전체를 일괄 삭제하지 않는다. |
| packages/contracts/src/native-clipboard.ts:148 | tableClipboardReadSchema + parseTableClipboardRead | 9+12줄. 운영 호출은 없고 native-clipboard.test.ts만 사용한다. 실제 Native UI는 native-clipboard-helpers의 readNativeClipboard → nativeTableClipboardSchema를 사용한다. v2 크기·원문·참조 방어 테스트는 실제 Native reader/schema로 유지한다. |
| apps/web/src/features/canvas/canvas-selection.ts:26 | translateSelectedNodes | 16줄. 전용 테스트만 사용. Native가 쓰는 selectionRect/intersectingObjects는 유지한다. |
| packages/model/src/sync.ts | isEffectiveChange, canApplyInverse, retainPendingOperations | 12+8+6줄. sync.test.ts만 호출한다. 이름이 v1 전용인 것은 아니며 제거된 클라이언트 경로 이후 운영 호출이 없어졌다. 실제 Native에서 쓰는 underlying 충돌·변경 함수의 검증은 유지한다. |
| packages/model/src/sync.ts | mergeCandidateOntoDocument, applyOperationsOverlay 및 내부 applyOperationOverlay | 운영 소비자는 없지만 database/native-sync.test.ts가 검증에 사용한다. Native 의미 검증을 현재 운영 함수로 옮기기 전에는 단순 삭제하지 않는다. |

private helper와 import 정리까지 포함한 최종 제거량은 구현 단계에서 다시 산정한다. 이 후보들을 1차 46줄과 합쳐 즉시 삭제 가능한 양으로 표현하지 않는다.

## Native에서 현재 사용하는 공통 기반

| 근거 | 의미와 권장 분리 |
| --- | --- |
| packages/model/src/database/native-document.ts:250,258,301,315 | NativeTable/NativeColumn이 기존 Table/Column의 physical 외 필드를 상속하고 NativeDesignDocument는 DesignDocument를 Omit한다. createEmptyNativeDocument도 createEmptyDocument를 사용한다. 도메인·뷰·메모·layout 등의 공통 구조와 빈 값 생성기를 먼저 추출한 뒤 v1/v2를 각각 조합하는 방향이 필요하다. |
| packages/model/src/personal.ts 및 table-canvas.ts | 개인 뷰·노드·공유/개인 분리와 canvas ownership은 양쪽 문서에서 사용된다. DesignDocument의 Pick이 있어도 v1 전용으로 간주하면 안 된다. |
| packages/model/src/sync.ts | sharedDocument/deriveOperationChanges/applyChanges는 Native 저장·복구에, inverseChanges/findInverseConflicts는 Native 이력에, deletionSnapshots는 Native sync/history에 사용된다. requestFingerprint와 구조 의존성·충돌 검증도 공통이다. |
| packages/contracts/src/native-sync.ts:18,35,38 | Native input/result/baseline 스키마가 sync.ts의 v1 input/result/baseline을 extend한다. 공통 actor·sequence·변경 경로·baseline 필드를 별도 기반으로 뽑고 Native가 그 기반을 사용하도록 바꾸기 전에는 v1 계약을 제거할 수 없다. |
| packages/contracts/src/native-history.ts:45 | syncOperationResultReadSchema로 과거 v1 및 Native 결과를 읽는다. 신규 v1 쓰기 계약 폐기와 과거 결과 reader 폐기는 별개다. |
| apps/web/src/features/projects/native-history-labels.ts:24 | Native 이력 표시도 DesignDocument와 NativeDesignDocument를 함께 받아 역사적 값과 타입을 표시한다. v1 읽기 타입·표시 함수는 필요하다. |

## 파일 호환과 기존 데이터 때문에 보존해야 하는 코드

- packages/model/src/database/migration.ts: v1 파일 가져오기와 기존 프로젝트 upgrade에 필요하다.
- apps/server/src/shared/native-import-provenance.ts: createEmptyDocument로 v1 증거 mask를 구성하고 migrateDesignDocumentV1로 다시 유도해 Native 파일 안의 legacy 값이 정당한지 검증한다. 단순한 과거 API 잔재가 아니다.
- rawDesignDocumentReadSchema, storedDesignDocumentSchema, projectTransferSchema 및 versioned reader: 기존 파일·원본 snapshot·감사 기록의 형식을 해석한다. strict 새 Native 쓰기 계약과 분리해서 유지한다.
- normalizeServerDocument 및 WorkspaceService.readLegacyExportDocument: 기존 저장 v1 프로젝트의 HTTP export에 사용한다.
- packages/model/src/postgres.ts의 exportPostgres: NativeDDLService가 기존 v1 PostgreSQL 원본의 DDL export에 여전히 사용한다.
- postgres-types, table-geometry의 기존 모델 계산: 파일 정규화·이력 표시·기존 대비 Native 렌더링 비교 및 QA 스크립트가 사용한다. 파일명만으로 폐기할 수 없다.

## 추가로 확인한 부채와 보류 항목

- apps/server/src/db/schema.ts:59,402의 projects.document와 sync_client_baselines.document가 여전히 .$type<DesignDocument>()이다. 실제로 Native 문서도 저장하므로 타입은 저장 문서 union으로 명시하는 후속 작업이 적절하다. 필드·테이블 자체를 삭제할 이유는 아니다.
- projects.document의 DB 기본값도 schemaVersion 1이다. 현재 제품 생성/가져오기는 v2를 명시한다. DB default 제거/변경은 데이터 마이그레이션 정책과 함께 별도로 검토해야 하며 단순 타입 정리로 바꾸지 않는다.
- removeDomain/upsertKey/upsertEnum/upsertTableRelation/createForeignKeyFromPrimaryKey 등의 운영 호출은 줄었지만 browser-smoke, browser-editor-persistence-smoke, prepare-defaults-domain-qa, prepare-dense-canvas-qa, prepare-editor-feedback-qa, prepare-responsive-qa 등에 dist import 또는 문자열 HTML 참조가 남아 있다. 이 스크립트를 조사·전환하기 전에는 무참조 후보로 분류하지 않는다.
- addDomain/addColumn 등은 파일 호환 테스트 fixture와 기준 구현을 구성한다. 테스트-only라는 이유로 전부 삭제하면 검증 기반을 잃는다.
- native-sync.ts의 “live v1 endpoint” 주석은 현재 폐기 상태와 맞지 않는다. 계약 기반 분리 시 해당 설명도 갱신해야 한다.

## 권장 다음 실행 순서

1. 1차 11개 선언을 한 단위로 제거하고 타입·관련 계약/모델 테스트·빌드를 검증한다.
2. Native 클립보드 저장소를 분리한 뒤 운영 미사용 v1 clipboard/selection 함수를 전용 테스트와 함께 정리한다.
3. 공통 문서 타입/생성기 및 sync contract 기반을 추출한다. 각각 기존 출력·파싱 규칙이 동일한지 검증하고 별도 커밋한다.
4. 남은 QA fixture와 역사적 reader를 구분해 옮긴 뒤 v1 mutation API를 추가로 제거한다. 파일 migration과 Native legacy provenance 검증은 유지한다.

이번에는 소스 변경이나 테스트 실행 없이 정적 참조 분석과 코드 확인을 수행했다. 조사 임시 스크립트/JSON은 정리했으며 docs/EZERD.txt는 수정하지 않았다.
