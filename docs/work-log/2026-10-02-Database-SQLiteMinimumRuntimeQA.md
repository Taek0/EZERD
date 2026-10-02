# SQLite 최소 버전 실행 검증 결과

- [계획](../planning/2026-10-02-Database-SQLiteMinimumRuntimeQA.md). 공식 [SQLite3.45.0](https://www.sqlite.org/releaselog/3_45_0.html) Windows x64 [archive](https://www.sqlite.org/2024/sqlite-tools-win-x64-3450000.zip)를 작업 전용 `.data/native-sqlite-345`에만 준비했다. PATH/설치 설정과 사용자 DB는 변경하지 않았다.
- 다운로드 zip SHA256: `771d3442164bc3b38c88365f5305b8e2efd9eddd10d59aeab114ac2ef99e2784`. 실행 version3.45.0/source ID `2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d`와 일치했다. 최근 Node 내장3.53.1 결과와 별도 증거다.
- `apps/server/scripts/verify-native-sqlite-floor.ts`는 compiler23개 선언 모두를 실제CLI :memory:에서 생성했다. UTF8 default HEX/값, FK와 CHECK 거부·cascade, generated식 결과5, expression/partial index, STRICT/WITHOUT ROWID 타입 거부 및 deferred FK transaction commit 성공/실패를 확인했다. 실행 PASS.
- 이것은 하한 엔진 실행이며 native API/웹 성공 DDL 다운로드 또는 전체 기능 활성화 증거를 대신하지 않는다. 임시 CLI는 최종 QA 뒤 정리한다.
