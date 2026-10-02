# Native 이력 MCP·웹 소비 계획

- 실제 trusted history REST 단위에 이어 MCP가 native baseline/이력/undo/restore 계약을 소비한다. v1 도구 응답 형식은 유지한다.
- 웹은 원본 native ledger를 조회하고 자신의 accepted 작업만 보상하며, 저장 전 로컬 pending/draft/storageFailure와 최신 head를 확인한다. 명령은 전송 전에 actor/project별로 보관하고 ACK 유실 시 같은 요청을 재생한다.
- 오래된 ACK를 최신 화면에 직접 덮어쓰지 않고 처리 결과 확인 뒤 versioned snapshot을 재조회한다. 새 baseline은 현재 version/sequence/revision과 일치해야 한다.
- 의미 있는 MCP 실제 호출/권한·출처 검증과 웹 명령 staging/재생 테스트, 타입/포맷/빌드를 수행한다. 전체 고급 기능 및 readiness 검증과는 구분한다.
