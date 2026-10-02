# C8 native DB 변환 후속 구현 결과

- 계획: [NativeConversion](../planning/2026-10-02-Database-NativeConversion.md).
- 상태: 담당 구현 ready. 현재 카탈로그 coverage는 모두 false이고 검증된 DB 간 물리 매핑은 0건이다. 실제 적용 지원은 v2 빈 물리 설계의 DB 문맥 변경과 기존 동일 문맥 no-op이다. 비어 있지 않은 설계의 DB 간 물리 변환 완료를 주장하지 않는다.
- 초기 사용자 지시에 따라 git add/commit은 보류했다. 커밋 전 replay 권한 보완 요청에서 C8 독립 커밋을 명시 승인받았다. 전체 pnpm check/build는 메인 담당이며 다른 담당 파일 및 기존 사용자 변경은 보존한다.

## 변경 파일

| 파일 | 내용 |
| --- | --- |
| `packages/model/src/database/conversion.ts` | 순수 planner, source/profile 일치, source engine/native graph 검사, 빈 설계의 raw clone 문맥 변경 및 target engine/write 검사, 객체별 손실·미검증 진단 |
| `packages/model/src/database/conversion.test.ts` | 23개 테스트. 세 DB 빈 문맥 변경/논리 데이터 보존, legacy, graph, 파라미터 및 현재 readiness false, PG/MySQL 정수·varchar·UUID·boolean·SQLite·생성·array·enum·index·check 차단 |
| `packages/contracts/src/database-state.ts` | 후속 승인 범위. 기존 입력/출력은 유지하고 preview에 optional `issues` 추가. `project-document-state`를 import하면 순환 초기화가 발생하므로 DB issue leaf 구조를 독립 정의하고 기존 canonical issue 계약과 동등성을 테스트 |
| `apps/server/src/workspace/project-database.service.ts` | native preview/apply 연결, 전체 raw 계약/UTF-8 예산, context와 snapshot 검사, row lock, replay 우선, 권한, 원자 적용, audit와 field version/baseline 경계, commit 후 1회 WS |
| `apps/server/test/project-database.service.test.ts` | 15개 서비스·계약 테스트. preview의 읽기 전용 동작, metadata 입력과 optional 진단 호환, 재계산, 권한, 충돌/overflow/full contract/예산, replay 권한 순서 및 알림 중복 방지 |
| `apps/server/test/project-database.integration.test.ts` | 15개 격리 PostgreSQL 통합 테스트. 실제 production 서비스/권한/SQL 트랜잭션/row lock/동시성/rollback/polling/기존 데이터 보존 및 workspace 보관/actor viewer 전환 뒤 ACK 재생 |
| `docs/planning/2026-10-02-Database-NativeConversion.md` | 착수 계획과 후속 계약 담당 승인 반영 |
| `docs/work-log/2026-10-02-Database-NativeConversion.md` | 이 결과와 메인 통합 사항 |

## 저장 및 보호 정책

- preview는 read 권한의 repeatable-read/read-only snapshot에서 진단한다. 기존 메타폼처럼 expectedVersion만 보내는 preview도 유지한다. preview는 적용 승인이나 최신 snapshot 증명이 아니다.
- native 신규 apply에는 expectedVersion, expectedSequence, expectedDatabaseRevision이 필요하다. project/document의 kind와 profile은 서버 저장값끼리 비교한다. v1 빈 물리 변경의 optional sequence와 schemaVersion 1 저장 원본은 유지한다.
- apply는 DatabaseService의 기본 writable 트랜잭션에서 `requireProject(read)` → 프로젝트 UPDATE lock → operation replay → 신규 요청의 `requireProject(manageProject)` 순서로 처리한다. `runProject(read)`의 PostgreSQL READ ONLY 트랜잭션으로 row lock을 시도하지 않는다. replay의 actor/fingerprint가 다르면 identity conflict이며 현재 문서/보관 상태/좌표가 달라져도 동일 요청 재생은 기존 결과를 반환한다. read 권한이 남아 있으면 workspace 보관/actor viewer 전환 뒤에도 동일 ACK를 재생하고, 신규 쓰기는 여전히 403으로 차단한다. read 권한 상실은 replay 전에 403이다. 재생 시 audit/WS는 추가하지 않는다.
- 잠근 최신 raw document에서 source/target의 전체 stored 계약과 예산을 검사하고 planner를 재계산한다. 물리 설계가 있으면 design 권한도 별도로 확인하며 현재 매핑 없음/readiness 정책으로 차단한다.
- native 실제 변경은 project DB 설정과 문서의 `/database`, version, syncSequence, databaseRevision을 함께 증가/저장한다. 기존 field versions/tombstones/history/개인 상태는 보존하고 `/database` 필드 버전만 upsert하며 이전 baseline을 삭제한다. source 원문·source version/sequence·from/to/revision·operationId를 audit에 같은 트랜잭션으로 보존한다.
- `projectDatabaseOperations`는 DB 변경 재생 ledger다. 임의 native sync 결과를 만들어 `syncOperations`에 넣지 않는다. native sequence 경계의 gap을 기존 polling이 감지하여 resetRequired 및 최신 snapshot을 반환하고 새로운 baseline을 발급할 수 있음을 실제 테스트했다. DB 전환을 일반 patch/undo로 재해석하지 않는다.
- converter는 arbitrary SQL 문자열을 치환하거나 대상 후보/모든 native 문서를 previous로 지정하지 않는다. 새 target 문서 검사는 previous 없이 호출한다. dormant logical native 필드는 원문을 유지하지만 provenance-bearing legacy는 논리 scope여도 DB 경계 이동을 차단한다.
- 설치 collation/charset, namespace, 생성/기본값/AST, 배열/ENUM/value-list, index/check, key/FK 및 SQLite 동적 의미는 affected objectId/path 진단으로 차단한다. 정수 폭·부호, varchar 길이, UUID/boolean의 이름 유사성을 검증된 무손실 매핑으로 인정하지 않는다.

## 검증

- 변경 코드 6개 파일만 `pnpm exec prettier --write ...`, `pnpm exec prettier --check ...`: 통과. docs는 저장소 `.prettierignore` 대상이다.
- `pnpm exec vitest run packages/model/src/database/conversion.test.ts apps/server/test/project-database.service.test.ts packages/contracts/src/database-state.test.ts packages/contracts/src/project-document-state.test.ts`: **43개 통과**. 신규 담당 38개와 기존 관련 계약 5개다. replay 권한 순서 회귀 2개를 포함한다.
- `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/project-database.integration.test.ts`: **15개 통과**. 로컬 일회용 `ezerd_qa_*` DB에 기존 마이그레이션을 적용하고 종료 시 삭제했다. workspace 보관/actor viewer 전환의 실제 fixture 2개에서 동일 ACK 재생, 신규 변경 403, actor/fingerprint 충돌, outsider 및 membership 제거 후 403, audit/WS 중복 없음까지 확인했다. 대상 DB 엔진의 DDL 실행/물리 변환 검증으로 계산하지 않는다.
- `pnpm exec tsc -p packages/model/tsconfig.json --noEmit`: 통과.
- 최신 source targeted typecheck: TypeScript compiler API로 위 담당 구현/테스트 파일을 rootNames에 지정하고 server compiler options의 noEmit 및 저장소 rootDir를 사용했다. module-resolution host에서 `@ezerd/model`/`@ezerd/contracts`만 현재 `src/index.ts`로 연결했으며 파일을 변경하지 않았다. **통과**. 메인이 추가한 model export를 포함하며 소스 및 테스트를 모두 검사했다.
- 일반 server `tsc --noEmit` 최초 검사에서는 구형 shared dist의 conversion/history 수출 누락 및 병렬 history 타입 오류가 있었다. 이후 위 최신 source 검사로 담당 파일을 확인했다. 메인은 공유 산출물 갱신과 source mocks 제거 뒤 41/13 및 전체 check 1109개 통과를 보고했다. 이 전체 검사 수치는 메인 보고이며 본 담당은 재실행하지 않았다.
- 커밋 전 최종 targeted typecheck는 TypeScript compiler API의 rootNames를 C8 구현/테스트 6개 파일로 제한하고 server compiler options의 noEmit/rootDir만 조정했다. 기본 workspace package resolution을 사용했으며 source alias, compiler host 주입 및 테스트의 source mocks는 없다. **통과**. production 서비스 생성과 실제 transaction rollback injection도 DatabaseService 의존성 추가에 맞춰 갱신했다.
- catalog/validation/coverage 정책, 권한 및 실제 PostgreSQL 트랜잭션을 위조하지 않았다.
- `git diff --check`: 통과.

## 필수 메인 통합 사항

1. 메인이 등록한 `planNativeDatabaseConversion` public export와 이 단위의 optional preview `issues`를 다음 shared 산출물에 포함한다. 기존 메타폼 preview 입력이나 DB revision 필수 apply 정책을 완화하지 않는다.
2. API/MCP DB change 입력에는 native snapshot의 expectedVersion/expectedSequence/expectedDatabaseRevision을 전달한다. 기존 metadata PATCH는 이 변환 서비스를 우회하는 경로로 사용하지 않는다. UI/API/MCP의 실제 HTTP 소비 QA는 메인/해당 담당 범위다.
3. WS와 polling 소비자는 DB 문맥 변경 시 원본 snapshot/새 baseline을 재조회한다. 기존 문맥의 queue/history를 새 DB에 자동 적용하지 않는다. history 담당은 DB 변경 ledger/audit 및 sequence 경계가 일반 sync patch가 아님을 유지한다.
4. 물리 매핑은 현재 전부 차단된다. 카탈로그 경로 검증과 실제 무손실 변환 fixture를 갖춘 다음 별도 단위에서 planner의 검증된 매핑을 추가해야 한다. 이번 빈 설계 storage 통합 테스트를 type/feature coverage 증거로 승격하지 않는다.
