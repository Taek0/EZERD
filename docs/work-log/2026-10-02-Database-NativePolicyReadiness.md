# C7 정책 API product readiness 연결 결과

2026-10-02. [계획](../planning/2026-10-02-Database-NativePolicyReadiness.md). 지정한 literals/key-policy/option-policy/expression-policy/index-policy와 각 test만 변경했다. registry/readiness.ts/catalog/features/validation/DDL/서버/UI/공유 root는 수정하지 않았다. git add/commit 하지 않았다.

## 반환 의미와 실제 registry 연결

NativeLiteralDecision/NativeKeyEligibility의 usable/coverage 및 option/expression/index decision의 usable을 boolean으로 바꿨다. allowed/primaryAllowed/uniqueAllowed, 기존 engine failure code/category/format 및 parser subset은 보존한다. engine 의미를 private 엔진 함수로 분리하거나 동일 inference 안에서 유지하고 registry evidence를 별도로 계산한다.

coverage는 실제 registry의 제품 경로+타입 readiness다. 모든 grammar/value가 지원된다는 뜻이 아니다. usable에는 engine allowed 및 실제 입력 조건도 필요하다. 따라서 verified declaration인 XML/jsonpath/installed object reference도 미구현 default parser/환경값은 usable=false다. None 및 generation none은 recovery/clear 의미를 유지하지만 coverage/usable로 새 기능 권한을 부여하지 않는다. target 없는 inspectNativeLiteralToken은 lexical 판단만 제공하며 항상 product coverage/usable=false다.

- literals: nativeDefaultCoverage와 실제 target type family coverage를 함께 요구한다. 원문 charset/length/precision/UUID/date/range/typedText 검사는 그대로다. malformed/out-of-range 값은 registry ready와 별개로 unusable이다.
- key: 실제 primaryKey/unique feature와 type family, generation feature를 요구한다. NativeKeyFacts.kind=primary|unique를 넘기면 해당 경로를 계산하고 생략하면 두 feature의 coverage를 보수적으로 요구한다. primaryAllowed/uniqueAllowed는 엔진 의미를 유지하여 MySQL virtual-generated PRIMARY와 UNIQUE를 구분한다. 기존 charset/composite/entry-size 조건은 남는다.
- option: builtin default/ON UPDATE는 nativeDefaultCoverage+실제 type을 요구한다. generation은 실제 serial/identity/autoIncrement/stored/virtual feature 및 type을 확인한다. computed에는 inference 결과/참조 type readiness도 필요하다. facts.typeId가 실제 type coverage를 대신 공급하지 못하도록 product 계산에서는 제거하고 actual typeId만 사용한다. 구 engine facts 판정은 변경하지 않는다.
- expression: default는 target과 default coverage, computed는 target+generationStorage의 실제 feature, CHECK는 check, predicate는 index+partialIndex, index expression은 index+expressionIndex가 필요하다. 모든 실제 참조 column type도 covered여야 한다. 새 NativeExpressionPolicyFacts.generationStorage=stored|virtual가 없으면 엔진 의미가 허용되어도 computed product permission은 false다. generation wrapper는 자동 전달한다. PostgreSQL virtual enum target/enum reference는 product 사용할 수 없다. typed literal의 대상 폭을 넘는 값도 기존 engine family inference의 allowed를 승격 근거로 삼지 않는다.
- index: PostgreSQL index+indexMethod 및 실제 scalar/array/project ENUM type family를 확인한다. infer 결과 사용에는 expressionIndex와 검증된 result family metadata가 필요하다. subtype 없는 number/enumId 없는 enum, JSON과 JSONB default opclass 차이, 다른 DB의 UUID/JSONB family를 storage 타입으로 임의 대체하지 않는다. 실제 AST 검증은 expression decision/validator가 별도로 수행한다.

## 타입 family와 명시 한계

내부 nativeTypeHasCoverage는 builtin의 실제 catalog 정의/DB/파라미터/STRICT 및 array feature를 계산한다. MySQL valueList는 실제 enum/set catalog+enumColumn/setColumn feature, PG projectEnum은 enumType(+array) feature를 요구한다. enum definition/reference existence 및 declaration 구조는 기존 document validator의 별도 책임이다. result family는 registry에 존재하는 실제 canonical 타입들의 coverage를 요구하며 caller의 usable/coverage/evidence를 신뢰하지 않는다.

부모 확인대로 SQLite declared/untyped에는 검증된 new-write family coverage가 없다. 일반 SQLite에서 엔진 문법상 허용되는 literal/default/key/inference 결과도 product coverage/usable=false로 유지하고 `readinessCode: 'type.declaration-not-ready'`로 표시한다. builtin column coverage를 빌리거나 fake typeId/새 flag를 만들지 않았다. STRICT는 document validator의 기존 제약도 적용한다. None/clear recovery는 이 readinessCode를 새로운 기능 권한으로 해석하지 않는다. 별도 새 선언/default 세로 경로의 evidence가 확보되기 전 지원 완료가 아니다.

native registry는 계속 definitions만 import하는 방향이다. 공유 계산은 literals의 internal nativeTypeHasCoverage 및 expression-policy의 internal nativeExpressionTypeHasCoverage를 통해 사용한다. literals→features/catalog/readiness, expression→literals, option→expression/literals, key→literals, index→key/expression/literals 방향이며 registry/definitions는 policy를 역참조하지 않는다. 두 내부 helper의 public barrel export는 요구하지 않는다. 기존 공개 API 이름과 engine result field는 유지한다.

## 부모 소비 인계

직접 computed expression의 usable을 확인하는 호출은 generationStorage를 넘긴다. storage 없이 허용된 AST를 특정 generated column의 쓰기 권한으로 처리하지 않는다. nativeGenerationDecision은 이미 실제 storage를 전달한다. key helper에서 특정 PK/UNIQUE를 판단하는 호출은 NativeKeyFacts.kind와 필요하면 strict를 넘길 수 있다. 직접 PG method decision의 inferred result는 expression-policy가 만든 numeric/jsonKind/enumId metadata를 소비하고 AST 자체 validation을 함께 유지한다. 이는 flags/evidence를 caller가 추가하는 API가 아니다.

부모 registry의 default/advanced evidence를 실제 프로브 뒤 활성화하면 이 함수들은 실제 hasDatabaseCoverage 결과를 그대로 소비한다. 본 단위는 flag를 변경하지 않았고 현재 false인 gate의 테스트를 강제로 true로 mock하지 않았다. 공통 feature gate/declared write policy/srid0·4326 preset/추가 MySQL functional byte/invisible 문제는 부모/다른 담당 범위다.

## 검증

- 지정5파일 **412 passed**, skip0. 기존396에16 meaningful cases 추가. global false 기대는 registry의 현재 coverage로 계산하도록 바꾸고 미검증 type subset/조건부 failure의 false 기대는 유지했다.
- engine eligibility 전 catalog matrix, default none/null과 checked/malformed token, project ENUM/valueList/array, generated PRIMARY/UNIQUE, sequence/AUTO_INCREMENT prerequisites, predicate/index/result family, unverified referenced type, caller evidence/typeId injection, unchanged invalid default의 previous recovery를 검사했다. 기존 node:sqlite 실행 tests도 포함한다.
- model build/typecheck, 다섯 test의 Node 타입 포함 strict 별도 typecheck 및 web typecheck 통과. 담당10개 파일 root Prettier 통과. 최종 broad targeted와 소비 패키지 typecheck는 ready 보고에서 확정한다.
- 새 PG/MySQL/SQLite advanced API/DDL 실제 probe는 부모가 수행한다. 이 unit의 readiness wiring 테스트를 새 SQL 실행 evidence 또는 모든 literal/option 완료로 주장하지 않는다. 전체 check/build/commit은 부모 담당이다.
