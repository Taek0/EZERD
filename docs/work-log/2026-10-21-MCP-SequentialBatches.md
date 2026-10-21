# MCP 순차 배치 요청 안내 반영

- 공통 instructions, apply_native_project_changes 설명, get_native_command_guide 응답에 동일 안내를 반영했다.
- 요청당 commands 1~100개, 병렬 전송 금지, 테이블→컬럼→키→관계 의존 순서, 관계선 일괄 명령 단독 요청을 명시했다.
- accepted ACK 후 summary 또는 document-state를 다시 조회하고 project.version, syncSequence/sequence, project.databaseRevision을 다음 요청 기준으로 사용하도록 했다. 임의 증가·이전 값 재사용을 금지한다.
- 배치별 새 operationId/groupId, 동일 clientId 유지, 실패/불명 시 후속 배치 중단 및 기존 operationId 결과 확인, 이미 승인된 배치의 중복 실행 방지를 안내한다.
- 실제 MCP 노출 3개 경로의 안내 포함 여부를 검증했다. 관련 21개 테스트 및 서버 빌드 통과. API 제한이나 저장 로직은 변경하지 않았다.
- 서버 재빌드·재시작 및 MCP 재연결 후 안내가 적용된다.
