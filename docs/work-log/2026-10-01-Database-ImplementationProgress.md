# DB별 타입·기능 구현 진행 상태

- 최종 갱신: 2026-10-02
- 구현 승인: Worker 1 최종 완료 후 계획 기반 구현을 진행하라는 사용자 지시.
- 착수 조건 충족: `Worker 1 - Sol`의 대상 turn `01a0f314-cc8d-7a32-b308-145ee97c80c2` 최종 완료를 확인하고 `e07e178`의 깨끗한 작업 트리에서 시작했다. 이후 그 대상 turn을 반복 대기할 필요가 없다.
- 기준: [구현 명세](../planning/2026-10-01-Database-CapabilitySpecification.md), [타입·기능 지원표](../planning/2026-10-01-Database-TypeFeatureMatrix.md).

## 완료한 단위

| 단위 | 상태 | 근거 |
| --- | --- | --- |
| C1 카탈로그/조건 | 완료 | `d7d8ddd`, [결과](2026-10-01-Database-CatalogImplementation.md). PG 65/MySQL 37/SQLite 추천 23 타입, 33 기능. 정의만 된 항목은 활성화하지 않음 |
| C2a native 모델/v1 순수 어댑터 | 완료 | `bf3d835`, [결과](2026-10-01-Database-NativeDocumentModel.md). 원본 보존/serial 분리/제한 식 및 참조 remap |
| C2b 구조 계약/전송 reader | 완료 | [결과](2026-10-01-Database-NativeDocumentContracts.md). 전체 `pnpm check` 통과, 678개 통과/43개 건너뜀 |
| C3a 순수 native 정책/복구 검증 | 완료 | [결과](2026-10-01-Database-NativeValidation.md). 엔진 규칙/활성 상태/초안 및 이전 원인별 복구를 분리. DB 모듈 43개 테스트 통과 |
| C2c/C3b 설정 저장·구문맥 보호 | 완료(해당 부분) | [결과](2026-10-01-Database-ContextPersistence.md). profile/revision 마이그레이션, 빈 물리 설계 DB 변경 API, sync/MCP/undo/restore/브라우저 보호. 전체 check 704개 통과, 격리 autosync 8개 통과 |
| C4a 카드 preview·capabilities 조회 | 완료(해당 부분) | [결과](2026-10-01-Database-CapabilityReadAndPreview.md). 공통 model/REST/MCP 조회, 카드 변경 전 preview, 실제 브라우저 빈 DB 변경/물리 설계 보호 확인. 전체 check 710개 통과, 격리 autosync 8개 통과 |
| C2d/C3 native sync 순수 모델 | 완료(해당 부분) | [결과](2026-10-01-Database-NativeSyncModel.md). indexes/checks/AST 원자 변경·snapshot·참조 read-set, DB/profile/문서 버전 보호. 전체 check 716개 통과, 44개 건너뜀 |
| C2e/C3 native sync 전송 계약 | 완료(해당 부분) | [결과](2026-10-01-Database-NativeSyncTransport.md). protocol v2/revision 필수·문맥 일치·v1 원본/재생 호환. 전체 check 720개 통과, 44개 건너뜀. live v2 쓰기는 비활성 |
| Native 삭제 역연산 순서 보존 | 완료(해당 부분) | [결과](2026-10-01-Database-NativeDeletionUndoOrder.md). v2 컬럼/키 등 삭제 전 순서 복원, v1 claim 유지. sync 34개 통과. 삭제 planner는 별도 단위로 진행 중 |
| C2f native 삭제·참조 정리 | 완료(순수 모델) | [결과](2026-10-01-Database-NativeDeletionReferences.md). review 가능한 영향/차단 목록, 명시 generated 연쇄 삭제, key/FK/index/check/layout 정리. 전체 check 737개 통과/44개 건너뜀 |
| C2g native 참조 ID remap | 완료(순수 모델) | [결과](2026-10-01-Database-NativeIdentityRemap.md). 모든 엔티티/AST/FK/ENUM/배치 참조 remap, 리터럴/legacy 원문 보존, 충돌·외부 참조 보호. 전체 check 743개 통과/44개 건너뜀 |
| C2h native clipboard 소비 준비 | 완료(계약/helper) | [결과](2026-10-01-Database-NativeClipboard.md). v2 envelope·DB/legacy 보호·ENUM 재사용·전체 후보 예산/모드 검증. 전체 check 753개 통과/44개 건너뜀. live paste는 아직 v1 |
| Native write legacy 출처 보호 | 완료(공통 정책) | [결과](2026-10-01-Database-NativeWriteProvenance.md). logical-only 신규 legacy 복제/원문·소유자·문맥 변경 차단, 기존 유지/복구 허용. 전체 check 757개 통과/44개 건너뜀 |
| C3 native sync 최종 후보 준비 | 완료(서버 helper/공통 graph) | [결과](2026-10-01-Database-NativeServerCandidate.md). raw claims/발급 baseline/DB 문맥/read-set/retired ID/current 후보 검증. 모든 scope 참조·원인별 복구. 전체 check 785개 통과/44개 건너뜀. live v2 endpoint는 미연결 |
| C3 native 원본/preview reader·공통 canvas | 완료(읽기 어댑터) | [결과](2026-10-01-Database-NativeReadPreview.md). 세 DB 원본 보존/별도 native preview·긴 node ID·private/shared canvas 정책. 전체 check 794개 통과/44개 건너뜀, 격리 autosync 8개 통과. live 저장은 v1 |
| C3 versioned snapshot 실제 조회·v1 보호 | 완료(REST 읽기) | [결과](2026-10-01-Database-VersionedReadApi.md). source/native preview·문맥 snapshot, native metadata/capabilities, 구버전 조회/쓰기 보호·old replay 보존. 전체 check 798개 통과/50개 건너뜀, 격리 HTTP+autosync 14개 통과 |
| C4 versioned MCP snapshot 소비 | 완료(MCP 읽기) | [결과](2026-10-01-Database-VersionedMcpRead.md). 실제 get_project_document_state/annotations·전체 계약/권한·REST 일치. 전체 check 800개 통과/51개 건너뜀, 격리 HTTP/MCP 7개 통과 |
| C3 native personal/review common canvas | 완료(개인 상태·리뷰 소비) | [결과](2026-10-01-Database-NativePersonalReview.md). 세 DB personal JSON 저장/읽기·리뷰·사용자 격리·전체 후보·원본 보호. 전체 check 803개 통과/54개 건너뜀, 최종 빌드 후 격리 HTTP/MCP/autosync 18개 통과 |
| C4 웹 versioned snapshot/native 조회 | 완료(조회 소비) | [결과](2026-10-02-Database-NativeWebRead.md). source 분기·personal merge·DB별 표시·이동/권한 보호, 세 DB 브라우저 GET/원본 보호 및 v1 WS 확인. 전체 check 813개 통과/54개 건너뜀, 격리 HTTP/MCP/autosync 18개 통과. native 편집/공유 저장은 미연결 |
| C4 native 생성·갱신/FK 파생 모델 | 완료(순수 모델/patch 계약) | [결과](2026-10-02-Database-NativeEditModel.md). DB profile 기본값·부분 갱신·원문/ID·FK base type/생성 옵션 분리·MySQL 상속 charset/collation·strict patch. 전체 check 833개 통과/54개 건너뜀, 단위 테스트 20개 통과. UI/shared ACK·SQL 실행은 미연결 |
| C3/C4 native MCP 개인 캔버스 명령 | 완료(실제 개인 상태 소비) | [결과](2026-10-02-Database-NativeMcpPersonal.md). generic canvas·긴 ID·global fallback·명시 개인 읽기·실제 MCP 명령/재생/사용자 격리/원본 보호. 전체 check 839개 통과/57개 건너뜀, 최종 격리 HTTP/MCP/autosync 21개 통과. 확대 API/MCP QA는 6건 미해소 |
| 전체 API/MCP 호환 QA | 완료(현재 연결 범위) | [결과](2026-10-02-Database-IntegrationCompatibilityQA.md). 내부 개인 선택 문맥의 strict 공개 응답 혼입 수정·canonical 공유 fixture·DB export metadata·새 조회 도구 실호출. 전체 check 839개 통과/57개 건너뜀, 최종 격리 API/MCP/versioned/autosync 40개 전부 통과. 앞 단위의 6건 해소 |
| C3/C4 native shared sync 저장·MCP 소비 | 완료(실제 REST/MCP 저장/ACK) | [결과](2026-10-02-Database-NativeSharedSync.md). native baseline/row lock/current 후보·ledger/field versions/deletion·ACK/WS/polling·MCP native patch/delete/FK 명령. 전체 check 840개 통과/62개 건너뜀, 최종 격리 API/MCP/versioned/autosync 45개 통과. 새 native 타입 gate는 아직 비활성 |

## 다음 작업

1. native shared REST/MCP baseline/operation/ledger/ACK/WS/polling을 연결했다. 다음은 native 웹 편집 소비와 v2 업그레이드/import/history 경로다. replay는 새 검증보다 먼저 유지하며 locked current 원문을 previous로 검증한다. native undo/restore는 trusted history/deletion provenance를 증명하는 별도 경로로 진행하고 ordinary legacy/retired ID 정책을 완화하지 않는다.
2. native 테이블/컬럼 factory·patch·FK·삭제를 MCP native 편집에 연결했다. native 웹은 아직 조회 전용이며 실제 편집 UI/durable queue·도메인 소유권 이동·native ERD/clipboard 소비를 공통 canvas/계약에 연결한다. 신뢰할 수 있는 소비/DDL/DB 실행 검증을 끝내기 전 신규 native 타입·기능은 usable로 활성화하지 않는다.
3. C4 프로젝트 DB별 타입/옵션/기능 편집 UI와 MCP를 연결한다.
4. C5 세 DB native DDL/공유 메뉴/실제 파일·DB 실행 검증을 완성한다.
5. C6/C7 고급 기본 타입·ERD 기능 및 C8 검증된 DB 변환/전체 QA를 이어서 수행한다.
6. FK 대체 후보(non-deferrable key/non-partial unique index 등)는 C3 검증기·planner·sync·DDL에서 공통화하고 실제 DB로 확인한다. 현재 전체 API/MCP/versioned/autosync 45개는 통과했으며 다음 기능 추가 후 관련 통합 QA를 유지한다.

전체 작업은 미완료다. 웹은 v1 편집/native 조회를 구분하고 shared 저장은 v1 및 native 전용 REST/MCP로 병존한다. 신규 native 기능은 사용 가능으로 활성화하지 않았다. 기존 데이터/공유 캔버스/사용자 관리 파일을 보존하고 단위별 planning/work-log/검증/커밋 뒤에도 전체 완료까지 같은 턴에서 이어간다. 사용자 수정 지시나 실제 턴 종료 사유가 있을 때만 예외를 둔다.
