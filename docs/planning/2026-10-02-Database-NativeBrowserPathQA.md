# Native 실제 브라우저 경로 QA 계획

- 로컬 PostgreSQL에 작업 소유 UUID QA DB를 생성하고 migrations 뒤 전용 owner/viewer·workspace를 준비한다. loopback3139에서 실제 빌드 AppModule/web를 실행한다. 브라우저에서 직접 로그인하여 생성·upgrade·clipboard·이력·JSON/DDL·권한/저장 복구 UX를 확인한다.
- 화면에 나타난 UI 상태로 검증하며 browser session storage/token을 검사하거나 주입하지 않는다. backend fixtures/counters/ledger는 격리 QA DB/API로 검사한다. native usable 활성화 이전 논리 경로 검증과 이후 실제 물리 SQL/DB 경로 검증을 구분한다.
- 임시 harness는 작업 중에만 보존하고 종료 시 listener/app/전용 DB를 정확히 정리한다. 사용자 DB/다른 listener/Downloads 원본을 삭제하지 않는다. 결과·실행 증거는 work-log에 기록한다.
