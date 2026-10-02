# Native 요청 취소 MCP·웹 소비 결과

- [계획](../planning/2026-10-02-Database-NativeCancellationConsumers.md)에 따라 `cancel_native_project_request`를 등록했다. 원래 request 전체는 SDK metadata에서 unknown으로 받아 특별한 JSON key/구형 필드를 제거하지 않으며 handler에서 전체 계약·원문 예산을 검증한다. outcome의 과거 ACK도 원문 custom 계약을 유지한다. 도구 수는 54개다.
- native command/history/upgrade의 미확인 요청 취소 버튼을 전용 서버 API에 연결했다. actor를 첫 await 전에 고정하고 동일 IDB row/송신 lease/heartbeat에서 원래 request를 전송한다. actor/op/group과 accepted 순서/revision이 맞아야 row를 해제한다. transport/404/잘못된 ACK는 보관하고 취소된 요청의 입력은 지우지 않는다. 이미 accepted였다면 해당 입력 revision만 소비하고 최신 source를 다시 읽는다.
- late UI callback은 현재 actor/project/컴포넌트에만 적용한다. native root의 기존 로컬 reset 버튼은 서버 취소 확정으로 교체했으며 history/upgrade도 read 권한으로 같은 요청의 처리 결과를 정리한다.
- 실제 AppModule versioned/MCP 43+5개 통과. 세 DB에서 새 도구로 취소→같은 late command의 rejected 원문 재생·marker 하나·설계/counter 불변을 확인했다. helper·root pending·history·upgrade 테스트 40개와 web typecheck 통과. 전용 cancellation backend는 `aa22d10`의 56개 실제 REST/DB 및 계약 13개로 별도 검증했다.
- 실제 브라우저 버튼/두 탭 unknown 회복은 후속 전체 QA에 포함한다. Node transport fixture를 브라우저/실 DB 성공으로 승격하지 않는다. private canvas PUT은 다른 version 계약이라 이 취소 endpoint로 위장하지 않으며 해당 UI는 revision 연결 전 비활성이다.
