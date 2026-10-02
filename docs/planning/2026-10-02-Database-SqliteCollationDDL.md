# SQLite column collation DDL 수정 계획

- feature 전체 실제 SQL 검사에서 저장된 SQLite NOCASE 설정이 DDL에 누락되어 비교가 case-sensitive로 실행됐다.
- 기본 SQLite collation BINARY/NOCASE/RTRIM을 컬럼 선언에 명시하고 실제 값 비교로 검사한다. 사용자 원문/타 DB SQL/등록되지 않은 환경의 검증 정책은 기존 공통 판정을 유지한다.
