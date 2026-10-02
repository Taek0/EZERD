# Native signed integer 검증 변환 작업 기록

- 계획: [NativeIntegerConversion](../planning/2026-10-02-Database-NativeIntegerConversion.md). 담당 변환/model·service 연결 단위 ready. git add/commit/full check/build/UI 변경은 하지 않았다. main index/validation/policy/history/cancellation과 다른 agent 변경은 보존했다.

## 구현 범위

- 실제 framework 파일은 `packages/model/src/database/conversion.ts`, service는 `apps/server/src/workspace/project-database.service.ts`다. 새 `conversion-rules.ts`는 PostgreSQL18/MySQL8.4 signed16/32/64 세 타입 쌍의 immutable engineVerified registry와 source/target coverage에 따른 동적 usable decision을 정의한다. callers가 verified/coverage/mapping을 주입하는 API는 없다.
- PG SMALLINT↔MySQL SMALLINT, PG INTEGER↔MySQL INT, PG BIGINT↔MySQL BIGINT만 명시 structured type으로 매핑한다. MySQL unsigned absent/false만 허용하며 alias/unsigned true/추가 params/deprecated/array/enum/legacy는 차단한다. SQL 문자열 치환, widening, decimal/float 정밀도 변경 및 arbitrary fractional/coercion/arithmetic equivalence는 수행하거나 주장하지 않는다.
- namespace는 PG empty/public↔MySQL current, table options는 PostgreSQL 기본↔MySQL InnoDB 기본만 변환한다. empty PG namespace는 기존 native compiler의 public canonical 의미와 같다. explicit charset/collation/설치 환경, 다른 namespace/engine, default(null 포함), generation, ON UPDATE, nonempty index/check/FK/deferrability는 affected objectId/path/code로 차단한다. 첫 범위의 physical PK/UNIQUE도 차단하며 feature 없는 logical key만 유지한다. SQLite affinity/coercion은 매핑하지 않는다.
- logical-only 객체도 mandatory physical payload를 같은 규칙으로 검사하며 unsupported 내용을 삭제하거나 무시하지 않는다. dormant table/column/schema/comment도 실제 feature readiness를 검사한다. 원래 ID/order/domain/logical/layout/views/notes/customProperties/comments/nullability를 유지하고 DB context/type/namespace/options만 변환한다.
- `planNativeDatabaseConversion`은 `engineVerified`, informational `candidate`, `sourceMap`, `changedPaths`를 준비한다. `document`는 실제 canApply=true일 때만 제공한다. source-map에는 escaped path, objectId, rule/fixture ID와 원래 source/target payload를 저장하므로 PG empty/public과 MySQL explicit signed=false 등 원문을 audit로 추적할 수 있다. unsupported source/graph/rule이면 partial candidate를 노출하지 않는다.
- target candidate는 엔진/native graph 검사, Banach `mysqlStringMetrics`/`inspectMysqlPhysicalDocument`의 선언/댓글 한도 검사, 실제 `validateDatabaseDocument(candidate,target,{mode:'write'})` 및 registry·feature coverage 검사를 거친다. candidate 또는 source를 previous로 지정하지 않는다. 댓글은 컬럼1024/테이블2048 code points 및 MySQL metadata UTF8 표현 가능성을 검사하고 emoji/invalid metadata 및 초과 원문을 그대로 보존한 채 차단한다.
- service는 preview 뒤 apply 때 locked latest row에서 plan을 다시 계산한다. source 및 blocked informational candidate까지 full native contract/raw1.5MB budget을 검사한다. read→row lock→same actor/fingerprint replay→새 manage 권한→design 권한(physical design 또는 source-map이 있는 dormant 물리 변경)→계획 재계산/정책 판단 순서를 유지한다.
- ready apply 경로는 project/document/version/sequence/revision을 한 transaction에서 바꾸며 baseline을 reset하고 changedPaths의 field versions만 업데이트한다. audit는 기존 sourceDocument/sourceVersion/sourceSequence와 새 source-map/engineVerified/`verified-signed-integer-v1` tag를 기록한다. 빈 native 변경은 `empty-native-context` tag를 유지한다. notification은 commit 뒤에만 전송하며 replay에는 추가 audit/WS가 없다. history/tombstone/personal state는 지우지 않는다.

## 실제 엔진 근거

- 재현 helper: `apps/server/test/native-integer-conversion.engine-helper.ts --verify-native-integers`. server workspace의 `tsx test/native-integer-conversion.engine-helper.ts --verify-native-integers`로 실행했다.
- PostgreSQL 실제18.6 및 MySQL 실제8.4.11. MySQL container exact ID `032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282`, qa label/native-ddl-20261002, network none/port 없음, 전용 volume identity를 inspect한 뒤 실행했다. 매번 양쪽 UUID `ezerd_integer_*` QA DB만 만들고 finally에서 정확한 DB를 삭제했다. 다른 DB/container/volume은 수정하지 않았다.
- 실제 source와 변환 candidate의 native DDL compiler 출력을 각각 PG/MySQL에 실행했다. PG public 및 empty namespace, MySQL current database/InnoDB를 확인했고 information_schema의 signed column type, numeric_precision, nullable/default metadata도 검사했다. JS Number 또는 부동소수점으로 BIGINT를 변환하지 않았다.

| Rule/fixture | 값 범위 | 실제 row 테스트 | overflow |
| --- | --- | --- | --- |
| pg-mysql-signed-int16-v1 / native-integer-int16-pg18.6-mysql8.4.11 | -32768..32767 | min/min+1/-1/0/1/max-1/max | PG22003 두 방향, MySQL1264 두 방향 |
| pg-mysql-signed-int32-v1 / native-integer-int32-pg18.6-mysql8.4.11 | -2147483648..2147483647 | 같은 경계 집합 | 동일4건 거부 |
| pg-mysql-signed-int64-v1 / native-integer-int64-pg18.6-mysql8.4.11 | -9223372036854775808..9223372036854775807 | 같은 집합 +9007199254740991/992/993 | 동일4건 거부 |

- 모든 값은 PG→MySQL→PG→MySQL 실제 engine text output을 다음 engine input으로 넣어 exact strings를 비교했다. nullable sibling은 NULL을 보존했다. MySQL session `STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION`에서 overflow를 거부했고, 실패 후 원래 row 집합도 유지됐다. 이 근거는 exact stored signed integers에만 적용하며 non-strict clamping/임의 입력 coercion/표현식/PK/FK 검증을 뜻하지 않는다.
- 공식 기준: [PG18 integer range/error](https://www.postgresql.org/docs/18/datatype-numeric.html), [MySQL8.4 signed range](https://dev.mysql.com/doc/refman/8.4/en/integer-types.html), [strict overflow](https://dev.mysql.com/doc/refman/8.4/en/out-of-range-and-overflow.html).

## 실제 서비스 검증과 activation 경계

- 현재 실제 catalog/feature coverage=false다. 엔진 mapping이 검증되어 informational candidate가 생성돼도 **nonempty integer 신규 apply는 실제 transaction에서 차단**되며 project/document/counters/baseline/audit/ledger/WS를 바꾸지 않는다. engine verification을 product usable로 승격하지 않았다.
- 새 로컬 `ezerd_qa_*` DB에 기존 isolated migration helper를 실행하고 `project-database.integration.test.ts`의 실제 service/PG transaction을 검사했다. 기존 빈 native6방향 및 v1 empty 변경, no-op, replay after viewer/workspace archive/lost read, duplicate/stale 경쟁 row locks, 문서 writer와의 충돌, post-write 실패 rollback, baseline reset/field/history 보존, false-gate integer apply 차단을 실행했다. 이는 direct service transaction 검증이며 HTTP/UI/MCP 통합 실행으로 주장하지 않는다.
- positive enabled **integer 저장·변환 source-map audit commit**은 현재 gate가 차단하므로 실행하지 않았다. 코드의 ready branch는 연결되어 있지만 main final activation 뒤 signed3종 양방향 실제 프로젝트 apply→row/doc/counters/source-map audit/field versions/baseline/WS/duplicate replay/rollback을 다시 실행해야 한다. coverage를 위조하는 positive tests는 작성하지 않았다.
- 활성화 조건에는 source/target type 경로와 target table/column/schema/comments 등의 feature readiness 및 실제 comment/MySQL physical policy 검증 연결이 포함된다. explicit charset/collation/PK/UNIQUE/FK/advanced/SQLite 범위를 추가 활성화하지 않는다.

## 검증 / main 통합

- 순수 model conversion/rules 및 service 전용 tests는 원래 공개 정책과 source를 사용한다. 기존 dist가 구버전일 수 있어 ignored `.data/native-integer-conversion.vitest.ts`에서 @ezerd/model을 최신 source index로 resolve하여 targeted run했다. source/policy 함수나 coverage를 mock하지 않았다.
- 담당 targeted Vitest3개 파일 **64개 통과**, 최종 readiness/권한 보완 뒤 실제 PostgreSQL service integration **15개 통과**, 실제2-engine3개 width fixture 및 총12 overflow rejection/roundtrip 통과. 최신 source paths 및 server tsconfig로 담당8개 구현/테스트 파일과 실제 import dependencies를 검사한 TypeScript program은 **diagnostics0**. metadata fixture의 pg rows type inference는 명시 row 타입으로 해결했다. 담당8개 파일 targeted Prettier와 tracked diff whitespace 검사 통과. 전체 pnpm check/build와 git add/commit은 수행하지 않았다.
- main은 새 conversion-rules registry/decision/types와 NativeDatabaseConversionMapping 타입을 공개 export할 필요가 있으면 index에 연결한다. 기존 plan 함수 public export는 유지한다. service 변경의 source-map/candidate 타입은 최신 model shared build 후 소비된다.
- 현재 REST preview DTO는 기존 canChange/issues를 유지한다. 새 candidate/sourceMap은 pure model 결과와 ready audit 경로에 있으며 HTTP preview 응답에 추가하지 않았다. 별도 source-map/candidate DTO 소비를 원하면 main이 contracts/UI를 확장해야 한다. UI/DDL/validator 파일은 수정하지 않았다.
- Banach `mysql-physical-policy.ts`의 실제 helper를 직접 소비한다. 해당 독립 단위의 commit/export/validator 연결은 main이 통합해야 한다. full check/build/commit은 main 담당이다.

## 담당 변경 파일

- main은 conversion registry/decision과 source-map/plan 타입을 public export로 연결했다. 중앙 MySQL 물리 정책 연결 이후 실제 catalog를 사용하는64개 targeted, shared build 및 격리 project-database service15개를 다시 통과했다. nonempty positive apply는 활성화 이후 실제 검증이 남아 있다.

1. `packages/model/src/database/conversion.ts`
2. `packages/model/src/database/conversion.test.ts`
3. 새 `packages/model/src/database/conversion-rules.ts`
4. 새 `packages/model/src/database/conversion-rules.test.ts`
5. `apps/server/src/workspace/project-database.service.ts`
6. `apps/server/test/project-database.service.test.ts`
7. `apps/server/test/project-database.integration.test.ts`
8. 새 `apps/server/test/native-integer-conversion.engine-helper.ts`
9. [계획](../planning/2026-10-02-Database-NativeIntegerConversion.md)
10. 이 작업 기록
