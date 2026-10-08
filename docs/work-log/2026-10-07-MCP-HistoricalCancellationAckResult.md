# MCP 과거 취소 ACK 출력 호환 수정

- [전체 점검 계획](../planning/2026-10-07-MCP-FullAuditPlan.md)의 두 번째 수정 단위다.
- NativeCancellationService와 계약 reader는 과거 v1 ACK를 원문 그대로 반환하지만 MCP outputSchema가 result.protocolVersion을 필수로 요구했다. v1 ACK에는 이 필드가 없어 정상 저장 이력도 SDK 출력 검증에서 실패했다.
- MCP의 얕은 출력 guard에서 protocolVersion 요구를 제거했다. handler는 계속 nativeCancellationResultSchema로 v1/v2 ACK 전체를 검증한다. 기록된 ACK에 protocolVersion을 새로 넣거나 actor 문자열을 정규화하지 않는다.
- 메모리 MCP 테스트와 실제 격리 DB의 v1 ledger fixture 테스트를 추가했다. recorded 결과와 역사적 actor 공백을 보존하고 프로젝트 버전·sequence·문서는 그대로이며 취소 마커를 생성하지 않는다.
- 이전 빌드 실행본에서 실제 MCP SDK의 result.protocolVersion 출력 실패를 재현했다. 공유 패키지와 서버를 최신 소스로 빌드한 뒤 versioned-document.integration **44개 테스트 모두 통과**했고 MCP 서버 테스트 10개도 통과했다.
- 실제 사용자 DB·서버 재시작·배포·docs/EZERD.txt는 변경하지 않았다. 최종 전체 검사와 metadata 보완은 다음 단위로 진행한다.
