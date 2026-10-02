# 캔버스 사용 경로와 호환 계층 감사 결과

- 날짜: 2026-10-02
- 조사 기준: 로컬 main `396ba24` (D:/ChatGPT/ERD), 정적 코드·분기·테스트 읽기.
- 기록 브랜치: `codex/performance-lab`. 조사 시작 시 lab은 `4db189a`로, 최신 main의 Native 도메인 편집·업그레이드·저장 복구 변경을 아직 포함하지 않는다.
- [계획](../planning/2026-10-02-Canvas-UsageAuditPlan.md)
- 제품 변경·삭제·DB 변경·워크트리 동기화·push는 수행하지 않았다.

## 결론

기존 Canvas와 NativeERDCanvas는 둘 다 제품 진입점이 있는 활성 구현이다. 특히 신규 프로젝트 생성도 현재 소스의 DB 기본값으로 schemaVersion 1을 사용하므로 기존 Canvas를 과거 데이터 전용 잔여물로 분류할 수 없다. 이번 범위에서 즉시 삭제해도 되는 캔버스 전체나 호환 모듈은 확정하지 않았다.

코드가 많은 이유는 문서 버전, DB별 물리 모델, 저장 프로토콜, 이전 로컬 미확인 요청 복구라는 서로 다른 책임이 병존하기 때문이다. 중복 실행은 정리 후보지만 데이터 보존 경계를 먼저 구분해야 한다.

## 실제 화면 진입 경로

| 시작 조건 | 경로 | 결과와 근거(main 기준 줄 번호) |
| --- | --- | --- |
| 일반 신규 프로젝트 | App.create → POST /api/projects → WorkspaceService.createProject → projects.document 기본값 | v1 생성. workspace.service.ts:91 및 db/schema.ts:58. 생성 서비스는 document 값을 지정하지 않고 schema/SQL 기본값은 schemaVersion 1이다. 운영 DB의 실제 기본값은 별도로 조회하지 않았다. |
| 프로젝트 열기 | loadProjectEntry → document-state + personal-state → projectEntry | 원본 sourceDocument.schemaVersion으로 분기. Native 미리보기 존재 여부만으로 편집기를 선택하지 않는다. project-entry.ts:28, 61. |
| 원본 v1 | projectEntry(kind=legacy) → App.replaceEntry → opened → Canvas | App.tsx:310, 1160 부근, 1274. 정규화 및 개인 상태 병합 후 기존 편집기 사용. |
| 원본 v2, 미리보기 사용 가능 | projectEntry(kind=native) → nativeOpened → NativeProjectView → NativeERDCanvas | App.tsx:1125, NativeProjectView.tsx:419. NativeDomainEditor와 NativePropertyEditor도 함께 사용하는 기능별 편집 UI다. |
| 원본 v2, 미리보기 사용 불가 | kind=native, document=null → NativeProjectView 오류 안내 | v1 편집기로 우회하지 않는다. NativeProjectView.tsx:401. 물리 모델을 v1로 축약하는 경로가 아니다. |
| 명시적 v1 업그레이드 | 기존 화면 NativeUpgradeButton → native-upgrade → 서버 NativeUpgradeService | App.tsx:1214, native-upgrade.service.ts:102. 서버가 잠근 v1 원본을 변환한다. 단순 열기와 저장형 업그레이드는 별개다. |

제품 호출자는 Canvas의 경우 App, NativeERDCanvas의 경우 NativeProjectView이다. 테스트 호출자는 제품 화면 경로와 별개다. lab에는 추가로 performance/index.html 및 native.html 측정 진입점이 있으며, 이 경로를 제품 사용 빈도에 포함하면 안 된다.

## 도메인 맵과 테이블 뷰의 관계

도메인 맵이 기존 캔버스이고 테이블 뷰가 Native인 구조가 아니다. 두 편집기 각각 내부에 overview와 테이블 뷰 분기가 있다. 문서 버전과 화면 모드는 서로 다른 축이다.

- 기존 Canvas는 도메인 관계선 layoutDomainRelations와 테이블 관계선 prepareTableRelations를 구분한다.
- 최신 main의 Native nativeCanvasScene(393행)은 overview에서 도메인/노트, 테이블 뷰에서 해당 테이블을 구성한다. overview 배치가 없는 도메인에 미리보기 노드를 보충하는 코드도 추가됐다.
- NativeDomainEditor는 도메인 편집 기능을 제공하는 보조 UI이며 세 번째 전체 캔버스가 아니다.
- Native 캔버스는 relationGeometry와 wheelCamera를 이미 공유한다. 이름이 다른 파일이라고 모두 독립적인 중복 구현은 아니다.

## 변환·호환 계층별 역할

| 계층 | 현재 호출 경로 | 유지 이유 / 제거 선행 조건 |
| --- | --- | --- |
| v1 정규화 | projectEntry, normalizeServerDocument → normalizeDocumentPhysicalTypes / normalizeSharedTableCanvas | 과거 타입 별칭과 공유 테이블 배치를 현재 v1 규칙으로 읽는다. 모든 저장본·가져오기·API 입력의 정규화 보장 전 삭제 불가. |
| Native 미리보기 reader | WorkspaceService.getVersionedProjectState → readNativeProjectDocument | 원본 rawSource와 preview를 분리한다. v1에는 migrateDesignDocumentV1, v2에는 DB 문맥 확인·배치 정규화를 수행한다. 조회만으로 원본을 저장하지 않는다. |
| 문서 v1 → v2 | database/migration.ts → reader, native-upgrade.service, native-transfer.service | 실제 업그레이드 및 구형 파일 가져오기에 필요하다. v1 UI를 없애더라도 외부 파일 호환 요구가 남으면 유지해야 한다. |
| Native 내부 legacy 값 | migration.ts의 legacy 타입·legacyExpression·legacyNamespace | 변환할 수 없는 원본 물리 정보를 보존한다. v2라는 이유만으로 legacy 필드를 제거하면 원본 정보를 잃을 수 있다. |
| DB 종류 변환 | ProjectDatabaseService.nativePlan → planNativeDatabaseConversion | PostgreSQL/MySQL/SQLite 물리 모델 간 변환이다. 문서 버전 마이그레이션과 다른 제품 기능이다. |
| 프로젝트 파일 전송 | project-versioned-export.ts, project-transfer.ts → export/native-transfer/import | v1 기본 export와 v2 또는 강제 versioned export가 분리된다. 서버 import는 v1 변환 및 전달된 preview의 일치 여부를 확인한다. |
| DDL | native-ddl.service.ts | v1 PostgreSQL은 기존 exportPostgres, 다른 v1 DB는 업그레이드 요구, v2는 exportNativeDatabaseDDL. 기존 DDL 경로도 호출 중이다. |
| 개인 캔버스 상태 | projectEntry, personal-state.service → reconcilePersonalState / mergeStoredPersonalState | 두 문서 버전에서 공유 문서와 개인 뷰·배치를 결합하는 공통 기능이다. 이름과 무관하게 구형 전용 코드가 아니다. |
| Native 로컬 저장 호환 | native-save.ts loadLegacyNativePending → durable queue.claim | 이전 Native 미확인 요청을 새 영속 큐로 인계한다. 여기서 legacy는 v1 편집기라는 뜻이 아니다. 미처리 로컬 데이터에 대한 전환·보존 정책 전 삭제 불가. |
| Native 클립보드 | native-clipboard-helpers.ts → readNativeClipboard / paste_native_clipboard | 원본 v2 확인과 Native 물리 정책 검증이 있는 별도 입력 경계다. 단순 문자열 복사 유틸과 통합하기 전에 버전별 데이터 보존 검증이 필요하다. |

## 저장·이력 경계

- v1: App.tsx:516 이후 opened 조건에서 ProjectSyncRuntime을 시작하고 edit/undo/redo를 호출한다. Canvas는 onChange를 통해 이 경로와 연결된다.
- v2: NativeProjectView의 save 및 native-save, native-durable-queue, native-history 계층을 사용한다. 캔버스·속성·도메인 편집이 이 저장 경로를 공유한다.
- 두 경로를 통합하려면 version/sequence/databaseRevision, operationId 재시도, 미확인 결과 회복, 권한 및 사용자 전환을 함께 검증해야 한다. 저장 관련 파일 수만으로 중복이라고 판단할 수 없다.
- 서버 MCP 설명과 처리도 source schemaVersion에 따라 apply_project_changes / apply_native_project_changes를 구분한다. 웹 화면만 전환해도 외부 편집 호환 경계는 남는다.
- 이번 조사로 Native의 실시간 원격 변경 반영이 v1과 동등하다고 검증한 것은 아니다. 기능 동등성 확인이 별도로 필요하다.

## 정리 후보와 우선순위

| 우선순위 | 후보 | 이번 판단 | 후속 검증 |
| --- | --- | --- | --- |
| 1 | Native 장면 중복 생성 | 최신 main도 NativeERDCanvas.tsx:701,716에서 nativeCanvasScene을 두 번 호출한다. 제거 가능한 중복 실행 후보. | 카메라 이동 시 계산 0회, 드래프트 중 표시/경로 정확성, 문서 변경 시 갱신 확인. |
| 2 | 장면 계산의 반복 find/filter | 테이블·컬럼·노드 조회를 반복한다. 문서별 인덱스 공유 후보. | 실제 호출 비용을 측정하고 캐시 무효화 범위 확인. |
| 3 | 두 편집기의 공통 기하·입력 책임 | 저수준 geometry와 wheel은 이미 공유. 나머지는 입출력 계약 비교 후 공통화 검토. | v1/v2 물리 타입 및 크기 계산을 억지로 같은 모델로 투영하지 않기. |
| 4 | 기존 편집기 축소/제거 | 현재 신규 v1 생성 경로 때문에 즉시 제거 불가. | Native 기본 생성 전환, 기능 동등성, v1 프로젝트 전환 정책, API/파일/이력 호환 결정. |
| 5 | 이전 Native 로컬 저장 복구 코드 | 활성 복구 경로. 삭제 미확정. | 구 저장 키에 대한 인계 및 미확인 요청 처리 정책과 회귀 테스트 필요. |

## 기존 편집기 제거를 결정하기 전에 필요한 확인

1. 신규 프로젝트를 Native로 만들지 제품 결정하고 모든 지원 DB의 초기 문서 계약을 검증한다.
2. 도메인/테이블/관계/노트, 개인 뷰, 복사·붙여넣기, 이력, 리뷰, 동기화, 가져오기·내보내기를 기능별로 비교한다.
3. 운영 v1 문서 수와 업그레이드 불가 사유를 승인된 읽기 방식으로 조사한다. 이번 작업에서는 사용자 데이터나 DB에 접근하지 않았다.
4. 읽기 전용 유지, 명시적 업그레이드, 자동 전환 중 정책을 선택한다. 구 파일 import와 서버 API 호환은 UI 제거와 분리해 판단한다.
5. 작은 모듈별로 호출자와 동적 진입점을 다시 확인한 후 삭제·회귀 검증한다.

## 근거 파일

아래 상대 링크는 lab에서도 존재하는 파일로 연결된다. 조사 근거는 main 396ba24이므로 최신 변경·줄 번호는 해당 커밋을 기준으로 확인해야 한다. 최신 main에만 있는 파일은 위 본문의 경로로 식별한다.

- [앱 진입](../../apps/web/src/app/App.tsx)
- [문서 버전 분기](../../apps/web/src/features/projects/project-entry.ts) / [분기 테스트](../../apps/web/src/features/projects/project-entry.test.ts)
- [기존 Canvas](../../apps/web/src/features/canvas/Canvas.tsx)
- [Native 화면](../../apps/web/src/features/projects/NativeProjectView.tsx) / [Native 캔버스](../../apps/web/src/features/projects/NativeERDCanvas.tsx)
- [서버 프로젝트](../../apps/server/src/workspace/workspace.service.ts) / [DB 기본값](../../apps/server/src/db/schema.ts)
- [읽기 어댑터](../../apps/server/src/shared/native-document-reader.ts) / [v1 마이그레이션](../../packages/model/src/database/migration.ts)
- [Native 저장](../../apps/web/src/features/projects/native-save.ts)
- [DB 변환](../../apps/server/src/workspace/project-database.service.ts)
- [버전별 파일 출력](../../apps/web/src/features/projects/project-versioned-export.ts) / [DDL](../../apps/server/src/workspace/native-ddl.service.ts)

## 검증 및 한계

정적 import·JSX 호출·버전 분기·DB schema와 SQL 기본값을 대조했다. project-entry.test.ts에는 v1이 preview 존재와 무관하게 기존 편집기를 유지하고 v2 오류 시 v1으로 되돌리지 않는 테스트가 있음을 확인했다. 테스트를 새로 실행한 것은 아니다. 제품 변경이 없는 문서 감사이므로 빌드/성능 측정은 수행하지 않았다. 운영 배포 커밋, 운영 DB 기본값, 실제 버전 분포, 미사용 코드 전체 및 기능 동등성은 확인 범위 밖이다.

문서 검증: pnpm format 및 pnpm format:check 통과. 두 감사 문서의 상대 링크 대상 존재 확인, git diff --check 통과. 포맷 실행으로 기존 제품 파일 변경은 발생하지 않았다.
