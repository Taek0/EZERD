# SQLite 최소 버전 실행 검증 계획

- 지원 하한 SQLite3.45.0의 공식 Windows x64 CLI를 workspace .data/native-sqlite-345에만 준비한다. 공식 archive URL·zip SHA256·SQLITE_SOURCE_ID를 결과에 기록한다. 시스템 PATH나 설치 설정은 변경하지 않는다.
- native compiler23개 기본 선언과 FK/check/default/generated/expression·partial index/STRICT/WITHOUT ROWID/deferrable 주요 fixture를 CLI :memory:에서 실행한다. 최근 Node 내장 SQLite3.53 결과와 최소 버전 결과를 구분한다.
- 실행할 SQL은 프로젝트가 생성한 자체 QA fixture다. 성공/거부 및 실제 값을 확인하고 결과를 제품 readiness 증거로 제공한다. 단독 엔진 QA를 제품 UI/저장/다운로드 성공으로 계산하지 않는다. 작업 완료 후 임시 CLI 폴더는 정리한다.
