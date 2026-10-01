# DB별 타입·기능 구현 진행 상태

- 최종 갱신: 2026-10-01
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

## 다음 작업

1. C3 나머지: 서버 lock 아래 native 최종 후보/legacy 원본 비교, v2 업그레이드/import와 native sync/이력 소비를 연결한다. 실제 소비 경로 준비 전에는 v2 저장을 활성화하지 않는다.
2. 다음 작은 단위는 native clipboard/remap 및 편집 생성/갱신이다. 삭제/sync/전송 순수 모델은 위 단위를 사용한다. 화면 어댑터를 준비해 저장 활성화 시 기존 클라이언트의 v1 재저장을 방지한다.
3. C4 프로젝트 DB별 타입/옵션/기능 편집 UI와 MCP를 연결한다.
4. C5 세 DB native DDL/공유 메뉴/실제 파일·DB 실행 검증을 완성한다.
5. C6/C7 고급 기본 타입·ERD 기능 및 C8 검증된 DB 변환/전체 QA를 이어서 수행한다.
6. FK 대체 후보(non-deferrable key/non-partial unique index 등)는 C3 검증기·planner·sync·DDL에서 공통화하고 실제 DB로 확인한다. 기존 전체 API/MCP 통합 실패 5건도 전체 QA 전에 해소한다.

전체 작업은 미완료다. 현재 모델/계약은 v1 API와 병존하며 실제 제품 화면과 서버 저장은 아직 v1이다. 신규 native 기능은 사용 가능으로 활성화하지 않았다. 다음 작업에서도 기존 데이터/공유 캔버스/사용자 관리 파일을 보존하고 독립 단위마다 planning/work-log/커밋을 완료한다.
