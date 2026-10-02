# Native 기본 함수·자동 생성 옵션 공통 정책 계획

- UI와 서버가 동일한 모델 API로 zero-argument builtin default, MySQL ON UPDATE, PG identity sequence를 판정한다. arbitrary 식 결과 추론은 별도 C7 단위이며 미검증 상태를 유지한다.
- identity 수치는 JS number 변환 없이 타입별 BigInt 폭·증분 0·상승/하강 기본 min/max/start·min<max·cache를 검사한다. 원문 token은 보존한다.
- default와 generation 및 ON UPDATE의 조합, array/DB 문맥/STRICT 타입 조건을 검사하고 readiness는 이번 단위에서 올리지 않는다.
- 공식 [PG sequence](https://www.postgresql.org/docs/18/sql-createsequence.html), [MySQL timestamp](https://dev.mysql.com/doc/refman/8.4/en/timestamp-initialization.html), [SQLite default](https://www.sqlite.org/lang_createtable.html)를 기준으로 경계 테스트 및 실제 선언/값 동작을 확인한다.
