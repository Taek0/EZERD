# MCP 취소 입력 검증 오류 수정

- [전체 점검 계획](../planning/2026-10-07-MCP-FullAuditPlan.md)의 첫 수정 단위다.
- cancel_native_project_request가 서비스 호출 전 nativeCancellationInputSchema.parse를 수행했다. 실패 시 ZodError가 MCP의 내부 오류 분기로 들어가 HTTP 상태·필드 경로를 잃는 문제를 재현했다.
- raw 요청을 기존 NativeCancellationService로 직접 전달하고 해당 서비스의 safeParse 실패에 code와 issues를 포함했다. 취소 fingerprint·원문 request·저장 이력·ACK 처리 순서는 유지한다.
- 실제 등록된 MCP 도구에서 잘못된 request identity와 history sourceOperationId 누락을 검사하는 회귀 테스트를 추가했다. HTTP 400, native.cancellation-input-invalid와 request/sourceOperationId 경로를 반환하며 DB transaction은 호출하지 않는다.
- MCP 서버·취소 계약 22개 테스트와 서버 타입 검사가 통과했다. 전체 점검의 격리 DB 17개 스위트/341개 테스트도 통과했으며 이 실행은 변경 전 전체 흐름의 기준 확인이다. 최종 전체 검사와 변경 후 통합 검증은 후속 결과에 기록한다.
- 실제 사용자 DB·서버 실행 상태·docs/EZERD.txt는 변경하지 않았다.
