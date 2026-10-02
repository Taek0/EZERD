# C3 native 읽기 preview와 공통 캔버스

- 시작 `4b631d2`, 작업 트리 깨끗함. v2 저장 활성화 전 서버의 원본/preview 구분과 화면 배치 준비를 진행한다.
- 타입/SQL과 관계없는 canonical table canvas 알고리즘을 v1/native 공통 구조로 일반화한다. 기존 v1 출력은 그대로 유지하며 native에만 긴 table ID의 생성 node ID 한도를 적용한다.
- 서버 reader는 raw source를 별도 보존하고 구조 reader 결과와 native preview를 구분한다. v1은 프로젝트 profile 기준 순수 migration 뒤 공유 캔버스를 정규화한다. MySQL/SQLite v1의 PG 원문은 legacy로 유지한다. native는 저장된 DB/profile과 프로젝트 문맥을 대조한다.
- GET/read helper는 DB를 쓰거나 baseline을 바꾸지 않는다. preview의 구조/전체 예산 검사 실패도 raw source 읽기를 잃게 하지 않는다. 이 경우 명확한 unavailable 진단을 반환한다. native engine/참조 진단은 read 모드로 계산해 복구 위치를 유지한다.
- migration 전후 원본 불변, 세 DB preview, v1 canvas 출력 동일성, native AST/index/check/legacy 보존, private view와 공유 메모/route 정규화, 긴 ID·멱등성, 예산·DB 불일치와 진단을 검증한다. reader/정규화가 실제 upgrade 저장을 대신하지 않음을 기록한다.
