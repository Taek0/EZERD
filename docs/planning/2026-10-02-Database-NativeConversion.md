# C8 native DB 변환 후속 단위

- 기준: [기능 명세](2026-10-01-Database-CapabilitySpecification.md), [타입·기능 지원표](2026-10-01-Database-TypeFeatureMatrix.md), [진행 기록](../work-log/2026-10-01-Database-ImplementationProgress.md).
- 담당 범위: model `database/conversion.ts`와 테스트, `ProjectDatabaseService`와 전용 테스트, 이 계획 및 완료 기록. 후속 사용자 승인으로 `contracts/database-state.ts`의 optional preview 진단 계약도 담당한다. 다른 병렬 작업 파일과 사용자 문서는 수정하지 않는다. 사용자 지시에 따라 git add/commit 및 전체 check/build를 실행하지 않는다.
- 현재 모든 카탈로그 coverage가 false이므로 DB 간 물리 타입의 검증된 매핑은 없다. 정수 폭, varchar 길이, UUID/boolean/SQLite affinity의 의미 일치를 가정하지 않는다.
- 순수 planner는 source/project 문맥, source engine 규칙, 전체 native 참조 graph를 검사한다. 빈 물리 native 문서는 DB 문맥만 변경한 raw clone을 만들고 target engine/write readiness를 검사한다. 물리 설계는 객체별 미검증 매핑, legacy, 설치 의존 옵션, 생성/기본값/AST/ENUM/index/check/제약의 진단을 반환하고 후보를 발급하지 않는다.
- 서버는 전체 stored 계약과 UTF-8 예산을 source와 target에 적용한다. preview는 읽기 전용 snapshot이며 apply는 manageProject 권한, 프로젝트 row lock, replay 우선, version/sequence/revision 충돌 검사 후 재계산한다. 물리 변환 시 design도 검사한다.
- 실제 native 빈 물리 적용은 project/document/context, version/sequence/revision, field version 경계, baseline 삭제, 원본을 포함하는 audit 및 operation ledger를 같은 트랜잭션으로 저장한다. WS는 commit 후 한 번만 발행한다. native polling은 sequence gap을 감지해 전체 snapshot을 재조회한다.
- 기존 v1 빈 물리 변경 및 동일 DB no-op/replay/읽기 권한은 유지한다. native apply의 expectedSequence는 필수이며 preview는 기존 읽기 계약을 유지한다.
- 검증: 지정 파일 Prettier, 순수 model/서비스 테스트, 가능하면 격리 PostgreSQL 실제 트랜잭션·동시 충돌·rollback. 타입 검사는 해당 패키지 범위로 제한하고 외부 병렬 변경 오류는 분리 보고한다.
- 메인 통합: model public index의 conversion export는 메인이 등록했고, preview 계약의 optional `issues: DatabaseIssue[]`는 후속 승인에 따라 이 단위에서 추가한다. API/MCP의 노출 및 공유 패키지 산출물 갱신은 메인 담당이다. 물리 매핑 활성화는 별도 실제 검증 완료 단위로 남긴다.
- 결과: [완료 기록](../work-log/2026-10-02-Database-NativeConversion.md).

## 커밋 전 replay 권한 보완

- 후속 사용자 승인: 담당 테스트 재검증 후 C8 파일만 독립 커밋한다. 전체 check/build는 메인 담당을 유지한다.
- `runProject(manageProject)`는 replay 전에 권한을 거부하므로 workspace 보관/actor viewer 변경 후 동일 ACK를 재생할 수 없었다.
- 변경 API는 DatabaseService의 기본 writable transaction에서 `requireProject(read)` → 프로젝트 UPDATE lock → actor/fingerprint replay → 신규 요청의 `requireProject(manageProject)` 순서로 처리한다. 물리 변환의 design 검사는 신규 쓰기에만 적용한다.
- read 권한 유지 시 기존 동일 ACK는 workspace 보관/역할 하향 뒤에도 반환한다. read를 상실하거나 actor/fingerprint가 다르면 재생하지 않는다. 신규 변경은 계속 manage/design 권한을 요구하고 workspace 보관/viewer에서는 403으로 거부한다.
- 직접 서비스 생성 테스트와 rollback injection을 새 transaction 경로로 갱신하고 실제 격리 PostgreSQL에서 role/archive replay, 권한 상실 및 신규 쓰기 거부를 검증한다.
