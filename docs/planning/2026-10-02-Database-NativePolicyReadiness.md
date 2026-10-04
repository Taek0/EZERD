# C7 default/key/expression/index/generation 정책의 product readiness 연결

2026-10-02. 담당 scope는 literals.ts, key-policy.ts, option-policy.ts, expression-policy.ts, index-policy.ts 및 meaningful tests이다. registry(readiness.ts)/catalog/features/validation은 부모가 소유하며 flags/evidence를 변경하거나 caller injection을 허용하지 않는다. shared root/UI/서버는 수정하지 않고 git add/commit 하지 않는다.

allowed/primaryAllowed/uniqueAllowed는 기존 엔진 판정을 보존한다. usable/coverage의 literal false 타입을 boolean으로 바꾸고 immutable 실제 registry의 hasDatabaseCoverage(default/native feature + type family)를 소비한다. global false 기대를 현재 verified gate 또는 미검증 subset/invalid 조건으로 수정한다. coverage는 제품 경로 evidence와 엔진 입력 허용을 구분하여 설명하며 unsupported grammar/환경 값은 usable이 될 수 없다.

none/clear recovery는 allowed여도 새 기능 활성 권한을 부여하지 않는다. lexical literal token 검사는 target 없는 product permission이 아니다. projectEnum은 enumType(+array) feature, valueList는 catalog+enumColumn/setColumn, builtin은 실제 정의/DB/파라미터(+array)를 확인한다. SQLite declared/untyped는 부모가 정의하는 별도 type family gate와 일반/STRICT 조건을 따르고 다른 builtin의 verified 상태를 임의로 빌리지 않는다. 구조/enum 참조 검사는 기존 document validator 책임이다.

default 함수/ON UPDATE는 nativeDefaultCoverage와 목적지 type coverage를 소비한다. generation은 실제 storage/serial/identity/autoIncrement feature와 type 및 computed expression의 product 가능성을 확인한다. expression은 목적(default/computed/check/index/predicate)에 필요한 feature와 target/실제 참조 column type 및 infer한 result family를 확인한다. index method는 index+indexMethod와 scalar/enum/array/result type family를 확인하고 expression 결과 사용에는 expressionIndex 경로도 요구한다. 단순 family 문자열이나 caller usable/evidence 값이 grant가 되지 않는다.

native registry는 definitions만 참조하는 방향을 유지한다. 다섯 policy 사이의 공유 type-family 계산이 필요하면 cycle 없이 literals의 얇은 internal export를 사용한다. 부모의 declared/default registry/API 계약을 먼저 읽어 맞춘다. MySQL functional 결과 byte/invisible 등 advanced issue는 부모/다른 agent 담당으로 유지한다.

의미 있는 tests는 activated 경로와 unsupported grammar/shape/환경 facts의 분리, projectEnum/declared/untyped/valueList 및 array/STRICT, none/clear, 참조 type/result readiness, 목적별 storage/method/feature, caller flags injection 무시 및 input/registry 불변을 확인한다. targeted model tests/typecheck/root Prettier 및 work-log 후 ready를 보고한다. 실제 3DB API/DDL probe는 부모 수행으로 구분한다.

부모 후속 결정: declared/untyped는 별도 evidence가 없으므로 현재 compatibility/read-only 및 기존 복구 의미를 유지한다. 새 declaration/default에 builtin coverage를 빌리지 않는다. 이 분기는 product coverage/usable=false 및 readinessCode=type.declaration-not-ready로 한계를 표시한다. 이를 위해 registry flag를 새로 만들거나 feature를 우회하지 않는다. 부모의 srid preset/공통 feature gate 및 실제 advanced/default probe는 별도 범위다.
