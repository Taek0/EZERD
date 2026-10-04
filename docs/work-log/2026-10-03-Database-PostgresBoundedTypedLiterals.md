# PostgreSQL bounded typed literal helper / 실제 cast proof

2026-10-03. [계획 및 부모 adapter hunk](../planning/2026-10-03-Database-PostgresBoundedTypedLiterals.md)의 소스/probe 독립 단위 ready. 기존 literals.ts/tests, XML/jsonpath, validation/registry/index/DDL 및 web sample은 수정하지 않았다. Git staging/commit도 수행하지 않았다.

## 확정 API와 허용 범위

`packages/model/src/database/postgres-typed-literal-helper.ts`의 `inspectPostgresBoundedTypedLiteral(context,type,literal)`는 엔진 subset의 allowed/code/category/format 또는 담당하지 않는 scalar에 null을 반환한다. SQL이나 타입 cast 문자열을 생성하지 않고 literals.ts를 import하지 않는다. caller flags/evidence를 받거나 registry를 변경하지 않는다. product coverage/usable, expression/참조 구조 및 enum 존재 검사는 기존 부모 경로의 책임이다.

| 범위 | 허용 | 명시 미지원 |
| --- | --- | --- |
| tsvector / tsquery | 영문으로 시작하는 ASCII 영문/숫자/underscore 단일 lexeme, 1~128자 | 위치/weight/prefix/operator/escape/인용/공백/여러 lexeme/검색 dictionary normalization |
| 6종 builtin multirange | typedText의 정확한 `{}` | nonempty range/whitespace normalization/범위 원소 parser |
| pg_snapshot | canonical decimal xmin:xmax:xip, unsigned64 exact BigInt, 정렬/중복 없는 xip 최대128개 | 현재·실재 transaction 또는 visibility 보장, 임의 parser normalization, deprecated txid_snapshot |
| 52 builtin PG 원소 타입 및 project ENUM 배열 | typedText의 정확한 `{}`, 선언 차원 정수1~6 | nonempty/NULL 원소/explicit bound/multidimensional 값 parser, reg*/money/deprecated 원소 타입, enum 참조 존재 증명 |

snapshot은 xmin/xmax의 low32가 0인 값을 PG가 실제 거부한다. 양수64bit만 확인하는 것으로 충분하지 않다. helper는 이를 BigInt bitmask로 차단하며 xip의 low32=0도 좁은 subset 밖으로 제한한다. xmin<=xmax, xmin<=xip<xmax, 엄격 오름차순을 확인한다. Number 안전 범위 밖에서 서로 Number로 반올림되는 인접 counter도 정확히 비교한다. 최고값 UINT64_MAX도 실제 cast로 검증했다. 이 문자열은 snapshot 구조일 뿐 실행 서버의 현재 snapshot을 참조하는 기본 함수가 아니다.

빈 배열은 PG에서 cardinality0이며 array_ndims 결과는 NULL(내부 ndim0)이다. 선언 차원과 실제 빈 값 차원을 같다고 주장하지 않는다. 각 builtin의 6차원 선언 cast도 실제 확인했으나 다차원 nonempty 값/UI readiness까지 완료했다는 뜻은 아니다.

## 실제 PostgreSQL proof

`apps/server/scripts/verify-native-postgres-bounded-literals.ts`는 configured URL의 localhost를 먼저 확인하고 PG **18.6 (Debian 18.6-1.pgdg13+2)** / UTF8을 검사했다. 새 UUID 전용 schema에 BEGIN/ROLLBACK을 실행하고 schema 제거를 pg_namespace로 확인했다. 기존 사용자 테이블이나 부모 QA resource를 변경하지 않았다.

최종 실행: **62 type defaults / 141 cast-default observations PASS**, rollback 확인. 2 search + 6 multirange + 1 snapshot + 52 builtin empty array + 1 project ENUM empty array다. 모든 fixture의 직접 parameterized cast 및 CREATE TABLE DEFAULT → INSERT DEFAULT VALUES → value::text를 비교했다. 배열 cardinality, snapshot counter/xip, search 길이128, xip 수128, Number 안전 범위 밖/UINT64_MAX 및 low32=0 경계를 포함한다. product가 차단하지만 PG가 받아들이는 grammar와 PG도 거부하는 값을 evidence에서 구분했다.

[재현 가능한 JSON evidence](assets/2026-10-03-Database-PostgresBoundedTypedLiterals.json)는 실제 버전/encoding/분류/값 및 rolledBack을 포함한다. probe의 DEFAULT DDL은 고정 catalog fixture 타입과 parameterized quote_literal output으로 작성한 엔진 proof이다. 아직 부모 adapter를 거친 product export 증거와 같다고 취급하지 않는다.

```powershell
pnpm --filter @ezerd/server exec tsx scripts/verify-native-postgres-bounded-literals.ts
pnpm exec vitest run packages/model/src/database/postgres-typed-literal-helper.test.ts
```

## 테스트·integration 인계와 한계

helper meaningful 경계 테스트 **104 PASS**, model typecheck PASS. 새 server probe/fixture/integration test는 server strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 기반 독립 noEmit typecheck PASS. 담당 TS 5파일 root Prettier check PASS. 임시 `.data/native-postgres-bounded-literal-typecheck.tmp.json`은 삭제했다.

`apps/server/test/native-postgres-bounded-literal.integration.test.ts`는 **62-case actual AppModule REST/MCP 저장·잘못된 default 거부·accepted/rejected replay·원문/version/sequence 보존·두 실제 export DDL 실행 값 검증**을 준비했다. compiled AppModule, 실제 MCP HTTP client, normal test-isolated localhost UUID DB를 요구하며 optional skip/registry injection/DDL 치환은 없다. product literalDecision의 allowed/usable가 실제 true가 아니면 명시적으로 실패한다. 준비된 파일은 타입 검사만 완료했고 **actual REST/MCP 62-case는 실행·PASS로 집계하지 않았다**. 부모 literals adapter 통합/빌드가 선행되어야 한다.

```powershell
pnpm build:shared
pnpm --filter @ezerd/server build
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-postgres-bounded-literal.integration.test.ts
```

fixture는 `native-postgres-bounded-literal-fixtures.ts`에 공통으로 두었다. 구조적으로 유효한 bad typedText를 REST/MCP 양쪽 candidate에서 거부하고 sequence만 증가하는 rejected ACK, accepted/rejected 원래 ACK replay 및 immutable source를 검증한다. 두 채널에서 받은 SQL을 각각 UUID schema에 rollback 실행한다. 부모의 전체 builtin type/parser/service 재검증 및 Singer web sample 연결은 이 단위에 포함하지 않는다. helper/API 및 standalone PG proof ready로 범위를 종료하며 부모가 adapter/public export와 actual service 결과를 이어서 검증한다.

근거: [PG18 text search input](https://www.postgresql.org/docs/18/datatype-textsearch.html), [PG18 snapshot](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT), [snapshot input source](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/xid8funcs.c), [FullTransactionId validity](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/access/transam.h), [array](https://www.postgresql.org/docs/18/arrays.html), [multirange](https://www.postgresql.org/docs/18/rangetypes.html). 허용 범위는 위 실제 probe에 근거하며 전체 literal parser 완료를 의미하지 않는다.
