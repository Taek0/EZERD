# Native 제한 식 의미 검증 계획

- CHECK/partial index는 boolean 결과, default/computed는 대상 타입에 맞는 결과를 요구한다. 식 구조만 통과하고 실제 SQL에서 타입 오류가 나는 입력을 차단한다.
- column ID의 현재 물리 타입과 각 builtin 함수/연산자의 인자·결과·DB 조건으로 제한 AST를 추론한다. typedText의 목표 타입 부재, 환경 의존 연산·함수 및 legacy 타입은 명시 차단한다. 임의 SQL 문자열/cast 추정은 사용하지 않는다.
- PG integer division/boolean, MySQL coercion과 volatile 함수, SQLite STRICT 저장형 차이를 보존한다. 이름/참조/순환 및 lifecycle은 기존 graph와 deletion/remap/sync 검증을 유지한다.
- 모델 경계·서버 공통 validator·실제 DB 정상/거부 조합을 검사한다. readiness 활성화는 이후 전체 소비·QA 단위에서 판단한다.
