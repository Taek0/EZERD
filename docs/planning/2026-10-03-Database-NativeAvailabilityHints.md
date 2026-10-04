# Native DB 옵션 상태 안내 수정 계획

- 실제 SQLite table 옵션 저장은 허용되지만 무조건 표시한 PG schema/STRICT 진단이 미지원·미검증으로 안내하는 문제를 수정한다. 해당 DB의 옵션에 실제 진단 코드가 있을 때만 조건을 표시한다.
- 검증된 default function/identity 및 engine 자체가 거부하는 조합에 무조건 제품 미검증 안내를 붙이지 않는다. 변경 가능한 기능/disabled 판정과 원문 보존·draft 정책은 그대로 둔다.
- DB별 table 선택, enabled timestamp 기본값 함수와 identity UI의 markup 회귀 및 웹 타입 검사를 수행한다.
