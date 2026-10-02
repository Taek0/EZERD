# SQLite column collation DDL 수정 결과

- [계획](../planning/2026-10-02-Database-SqliteCollationDDL.md). SQLite column options의 BINARY/NOCASE/RTRIM을 실제 `COLLATE` 선언에 출력했다. 이전 compiler는 PG/MySQL만 출력하여 NOCASE 비교가 실제0으로 실패했다.
- Node SQLite 실제 생성·INSERT·각 collation 값 비교 회귀와 기존 DDL162개 통과. model/contracts shared build 통과.
- 후속 `verify-native-feature-path-ddl --prepared`는 PostgreSQL18/MySQL8.4/SQLite3.45.0의77개 기능 조합 전체 SQL/값·메타데이터 검사에 통과했다. 저장·API 소비의 증거와 구분한 engine-prepared 결과는 `.data/native-feature-prepared/501cf437-1751-4bfc-aeaa-b63c35848a21`에 보관했다. 자체 MySQL UUID DB/PG rollback schema/SQLite memory만 사용했다. 실제 API 산출 DDL manifest 검증은 후속 활성화 단위다.
