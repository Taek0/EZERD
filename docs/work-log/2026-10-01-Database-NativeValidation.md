# C3a native DB 정책·복구 쓰기 검증 결과

- 날짜: 2026-10-01
- 계획: [C3 서버 정책](../planning/2026-10-01-Database-ServerPolicyImplementation.md)

## 변경

- `inspectNativeDatabaseDocument`는 DB 엔진 조건을 검사하고 `validateDatabaseDocument`는 제품 활성 증거와 read/write/export 규칙까지 적용한다. 검증된 지원 상태를 임의로 높이지 않았다.
- DB/profile 일치, native 타입/파라미터/namespace/테이블 모드, 소유 객체·물리 범위·이름·ENUM, 생성/기본값·키/FK 및 구조화 식/인덱스/CHECK의 문맥과 참조를 검사한다.
- 복구 쓰기는 서버에서 읽은 previous 문서를 기준으로 오류 ID/경로/원인 필드/참조 문맥을 비교한다. 오류 개수 비교로 새 문제를 묵인하지 않으며 DB 문맥 오류는 항상 거부한다. 설명/배치 수정은 원인 데이터를 바꾸지 않으면 허용한다.
- 숫자 문자열의 정수 범위와 소수 scale 반올림 후 범위를 검사한다. FK의 정수 부호/컬럼 및 상속된 테이블 collation을 확인하고 PG ENUM 배열과 MySQL BOOLEAN 별칭도 구분한다.
- 작성 중 빈 이름/테이블/FK는 incomplete로 구분하여 쓰기 검증에서 제외하되 DDL에서는 오류로 반환한다.
- 생성 식의 DB별 함수/인자/불변성 조건, generated 참조/순환 및 기본값의 컬럼 참조를 검사한다. SQLite generated PK와 MySQL virtual generated FK 대상 제한은 [SQLite](https://www.sqlite.org/gencol.html), [MySQL](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html), [PG](https://www.postgresql.org/docs/18/ddl-generated-columns.html) 공식 자료로 확인했다.

## 검증과 한계

- 모델 빌드 통과. 모델 전체 18개 파일 172개 통과 후 ENUM 배열/BOOLEAN 회귀를 추가하여 DB 모듈 3개 파일 43개 통과.
- 정책 테스트는 총 18개이며 stale context, 기존 오류 복구/복제 방지, STRICT/생성 조건, 수치/NULL/함수 기본값, FK/콜레이션, 식 참조/순환 및 초안을 확인했다.
- API 및 실제 DB에 아직 연결하지 않았다. SQL 출력기의 전체 타입별 기본값/인덱스 접근 방식·실행 환경 검증은 C5~C7의 실제 실행 fixture와 함께 보완한다. 이번 결과가 native 기능 전체의 검증 완료를 의미하지 않는다.
- private 오류 원인 fingerprint는 사용자 응답에 노출하지 않는다. 다음 서버 연결은 client baseline 대신 저장된 previous 문서를 전달해야 한다.

## 다음

프로젝트 profile/revision 저장·마이그레이션, 기존 v1 API의 DB 변경/동기화 문맥 보호를 연결한다. v2 소비 경로를 준비하기 전에 v2 저장을 활성화하지 않는다.
