# PostgreSQL 타입 전용 bounded literal subset

2026-10-03. C6 T2의 별도 단위. 새 model helper/tests, actual PostgreSQL cast probe 및 새 REST/MCP integration test와 완료 로그만 담당한다. literals.ts/tests, XML/jsonpath, registry/index/validation/DDL, web literal sample 및 다른 agent 파일은 부모/Singer 소유이며 직접 수정하지 않는다. Git add/commit은 부모 담당이다.

## 엔진 subset과 경계

- tsvector/tsquery: ASCII 영문으로 시작하는 영문/숫자/underscore 단일 lexeme, 1~128자. 인용/escape/위치/weight/prefix/operator/공백/다중 lexeme/임의 query 문법은 unsupported. 직접 타입 input cast이며 검색 dictionary 함수나 normalization을 실행하지 않는다.
- int4/int8/num/ts/tstz/date multirange: typedText의 정확한 `{}`만 허용. 비어 있지 않은 range parser는 별도 미구현이다.
- pg_snapshot: canonical unsigned decimal `xmin:xmax:xip`, xmin/xmax 1~UINT64_MAX, xmin<=xmax, low32!=0. 실제 PG에서 epoch 경계의 low32=0 counter 거부를 확인했다. xip는 빈 목록 또는 128개 이하의 엄격 오름차순/중복 없는 xmin<=xid<xmax. Number 변환 없이 BigInt로 비교한다. 실제 캐스트의 구조적 값만 보장하며 존재한 transaction/현재 MVCC 상태/visibility를 증명하지 않는다. txid_snapshot은 deprecated 차단 유지한다.
- PG array: 검증된 builtin 타입과 프로젝트 ENUM의 typedText `{}`만 검사한다. 정수 선언 차원 1~6은 구조 검사하며 PostgreSQL 빈 배열 값의 ndim=0/cardinality=0을 명시한다. 선언 차원은 원소/실제 차원을 강제하지 않는다. project enum 참조 존재와 default/type/array readiness는 기존 중앙 검사에 남긴다. deprecated 및 reg*/money 등 환경 의존 원소 타입은 conservatively 차단한다. 비어 있지 않은 원소나 explicit-bound/NULL/다차원 값 parser를 주장하지 않는다.

helper는 literals.ts를 import하지 않고 allowed/code/category/format 엔진 부분만 반환한다. 담당하지 않는 scalar는 null을 반환하며 none/null/expression/recovery는 기존 경로를 유지한다. 다른 DB/profile/미등록 타입/잘못된 parameters/문자 토큰/typedText가 아닌 값은 신뢰하지 않는다. 부모 adapter는 공통 literalDecision의 실제 registry coverage/usable 계산 전에 helper를 연결하고 기존 배열 blanket blocker를 교체한다. SQL 문자열 출력이나 임의 SQL 실행 기능은 helper에 없다.

## 검증

공식 PG18 text-search, snapshot 및 array/range 문서와 REL_18_STABLE input 구현을 대조한다. configured URL의 localhost를 먼저 검사하고 PG18.6 실제 cast는 전용 UUID schema에서 BEGIN/ROLLBACK으로 실행한다. 고정 allowlist type SQL과 parameterized value를 사용한다. 대표 good/정확 경계/거부 사례를 구분하고 엔진이 받아들이지만 제품 subset이 차단한 문법도 기록한다.

parent adapter 적용 뒤 normal test-isolated UUID DB의 AppModule HTTP 및 실제 MCP native commands로 각 타입 default 저장/원문/ACK/replay/잘못된 변경 거부를 확인한다. 실제 REST/MCP export DDL을 같은 QA DB의 UUID schema에서 rollback 실행하고 INSERT DEFAULT VALUES의 text/cardinality/snapshot counter 값을 확인한다. adapter 미연결 때는 성공으로 취급하지 않고 의존성을 명확히 보고한다. strict typecheck/targeted tests/root Prettier 및 actual probe 결과를 work-log에 남긴다.

근거: [text search](https://www.postgresql.org/docs/18/datatype-textsearch.html), [snapshot](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT), [arrays](https://www.postgresql.org/docs/18/arrays.html), [range](https://www.postgresql.org/docs/18/rangetypes.html), [snapshot input source](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/xid8funcs.c).

## 부모 adapter 인계

새 `postgres-typed-literal-helper.ts`의 `inspectPostgresBoundedTypedLiteral`만 상대 import한다. helper는 기존 literals/registry를 import하지 않는다. 아래 hunk는 `engineLiteralDecision`에서 legacyExpression 거부 뒤, blanket array 거부 앞에 넣는다. XML/jsonpath parser와 public export/readiness/registry는 부모/Singer가 통합한다. 이 문서의 hunk는 실제 production 파일에 적용하지 않았다.

```ts
import { inspectPostgresBoundedTypedLiteral } from './postgres-typed-literal-helper.js';

// Existing profile/type/parameter/none/null/legacyExpression checks remain above.
if (context.kind === 'postgresql' && value.kind === 'literal') {
  const bounded = inspectPostgresBoundedTypedLiteral(context, type, value);
  if (bounded)
    return bounded.allowed
      ? ok(bounded.format!)
      : no(bounded.code!, bounded.category);
}
// Existing blanket array fallback, expression/token and other type handlers follow.
```

None/null recovery와 AST의 target-free typedText 차단은 변경하지 않는다. helper의 allowed는 타입별 엔진 subset이며 product usable/coverage 승격 권한이 아니다. 기존 literalDecision wrapper와 validator가 registry/default/type/array coverage 및 프로젝트 ENUM 존재를 계속 확인해야 한다. 이후 XML/jsonpath/search/multirange/snapshot blanket scalar blocker는 각 담당 helper로 처리된 결과만 먼저 반환하며 미지원 grammar에는 계속 unsupported를 반환한다.