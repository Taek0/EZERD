# Native 키 후보 readiness UI 수정 계획

- 실제 MySQL 브라우저에서 사용 가능한 키 후보에도 key.not-ready가 표시되는 원인을 수정한다. 공통 판정의 usable가 true인 후보에 미검증 코드를 붙이지 않는다.
- PRIMARY/UNIQUE 및 SQLite STRICT 문맥을 공통 keyEligibility로 전달한다. MySQL virtual generated의 UNIQUE 가능/PRIMARY 불가 등 조건 차이를 UI에서 덮어쓰지 않는다.
- source/현재 원문을 변경하지 않는 helper와 구조 선택의 양성·음성 회귀, typecheck 및 실제 MySQL PK 저장을 검사한다.
