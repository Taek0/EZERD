# Native 이력 MCP·웹 소비 결과

- [계획](../planning/2026-10-02-Database-NativeHistoryConsumers.md)에 따라 MCP native baseline/이력 조회/undo/삭제 restore 4개 도구를 연결했다. 기존 v1 도구 형식은 유지한다. SDK metadata에는 원문 payload를 열어두며 handler에서 전체 계약을 검사한다.
- 세 DB 실제 MCP에서 logical 편집→이력→baseline→undo 및 삭제→fresh-ID restore, 같은 요청 ACK 재생을 확인했다. versioned 실제 AppModule 37개 통과. MCP 통합 5개도 새 도구 목록 53개로 통과했다. 첫 실행의 신규 삭제 fixture는 `objects`를 `targets`로 수정하고 versioned 전체를 재검증했다.
- 웹 native 이력 창은 저장 ledger를 페이지로 조회하고 자신의 accepted native 작업에만 보상 버튼을 제공한다. 현재 서버 baseline/head/revision과 로컬 pending·draft·storageFailure를 확인한다. body를 전송 전에 actor/project별로 보관하며 응답 유실 후에는 동일 body를 재생한다. ACK actor/operation/group/source/command/DB 문맥이 일치해야 요청을 해제한다. 최신 화면은 ACK 원문을 덮어쓰지 않고 별도 snapshot을 재조회한다.
- terminal 4xx 거부와 read 권한으로 확인한 해당 ledger 404가 함께 있어야 보관 요청을 해제한다. 네트워크/조회 권한 실패와 잘못된 ACK는 보존한다. 이력 pending이 있는 동안 일반 native 편집 및 export는 차단한다.
- targeted MCP/저장/이력 테스트 28개, web typecheck 통과. 이력 backend는 독립 단위 `de644d4`이며 실제 AppModule REST/DB 35개와 계약 5개를 확인했다.
- 한계: 이력 창의 실제 브라우저 검증은 후속 전체 QA에서 수행한다. 현재 localStorage staging의 탭 간 원자성과 storageFailure 입력 복구는 별도 durable queue 단위에서 보완한다. v1/upgrade 경계를 넘는 복구와 provenance가 제거된 source는 backend가 차단한다. readiness/coverage는 변경하지 않았다.
