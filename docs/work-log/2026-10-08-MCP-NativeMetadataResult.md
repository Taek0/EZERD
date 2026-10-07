# Native MCP 상세 계약 노출·전체 흐름 보완

- [전체 점검 계획](../planning/2026-10-07-MCP-FullAuditPlan.md)의 세 번째 수정 단위다. 취소 입력 오류와 과거 ACK 호환 수정은 각각 [취소 검증](2026-10-07-MCP-CancellationValidationResult.md), [과거 ACK](2026-10-07-MCP-HistoricalCancellationAckResult.md)에 기록했다.
- import_project가 format/formatVersion 외 필수 필드를 숨기고, Native 수식의 전처리 schema가 JSON Schema 변환에서 빈 객체로 표현되는 문제를 확인했다. 조회·내보내기·이력·취소 출력도 문서/ACK의 내부 구조를 충분히 노출하지 않았다.
- mcp-schema-metadata.ts에서 공통 계약을 기반으로 원문 reader와 수식 AST의 구조를 JSON Schema로 표현한다. v1 파일, compact v2 파일, 원본+별도 preview가 있는 versioned v2 파일의 세 가지 가져오기 형식을 제공한다.
- 취소 종류별 request UUID와 history sourceOperationId 필수 조건, v1/v2 기록된 ACK, Native 문서·baseline·이력·복구 결과의 상세 구조도 노출한다. 입력 metadata와 실제 handler 검증은 분리해 과거 원문·fingerprint·replay·legacy 증거를 정규화하지 않는다.
- 재귀 수식과 반복되는 문서/테이블/컬럼 구조는 definition 참조로 묶고 문서 루트 기준으로 reference를 배치한다. 파생 Zod schema가 원래 부모를 다시 방문할 때 자기 자신만 가리키는 definition이 생기지 않도록 실제 컴포넌트 본문을 확장한다.
- 전체 42개 도구의 입력 JSON Schema를 실제 MCP SDK의 AJV provider로 컴파일하고 출력 validator도 tools/list에서 생성한다. 예제 3개 파일 형식과 재귀 수식은 통과하고 필수 필드 누락·잘못된 수식 값·history sourceOperationId 누락은 실패한다. 원문 request의 __proto__ 키와 문자열도 유지한다.
- update_project 설명은 Native v2 DB 종류 변경을 지원하는 것처럼 읽히지 않도록 수정했다. 이 도구의 기존 정책과 실제 DB 변환 서비스는 변경하지 않았으며 새 변환 도구를 등록하지 않았다.
- 실제 HTTP MCP 클라이언트가 먼저 tools/list를 조회해 출력 검증을 활성화한 뒤 PostgreSQL/MySQL/SQLite 생성·공유 편집·capabilities·DDL·export·리뷰 생성/답글/조회/해결/삭제·알림 조회/읽음 변경·개인 상태·Native 이력·프로젝트 보관/삭제를 수행하는 통합 테스트를 추가했다. 타인의 알림 변경도 거부된다.
- 상세 스키마의 중복을 줄이기 전후 측정: 전체 tool metadata JSON은 675,465→621,770자, 입력 스키마 합계는 205,241→156,240자였다. 동일한 상세 계약을 비교한 JSON 길이이며 네트워크 압축/모델 토큰/브라우저 성능의 실측이 아니다.
- 메모리 MCP 테스트 15개와 초기 변경 후 격리 DB 4개 스위트/68개 테스트가 통과했다. 최종 전역 검사·17개 통합 스위트 결과와 42개 도구별 점검 범위는 [전체 결과](2026-10-08-MCP-FullAuditResult.md)에 기록한다.
- 실제 사용자 데이터·DB 스키마·서버 재시작·배포·docs/EZERD.txt는 변경하지 않았다. 동시에 진행 중인 v1 QA 폐기·저장 타입 정리는 별도 작업이다.
