# MCP 사내 LAN 호스팅 구현 기록

작성일: 2026-09-17

## 공통 서비스 경계

- 프로젝트 CRUD를 `WorkspaceService`로 분리하고 REST 컨트롤러의 기존 세션 인증 순서를 유지했다.
- 리뷰 조회·생성·답글·수정·삭제와 알림 처리를 `ReviewService`로 분리했다.
- 리뷰 쓰기는 기존 트랜잭션 잠금·검증을 그대로 사용하며, WebSocket 이벤트는 트랜잭션 커밋 뒤에 발행한다.
- 서버 TypeScript typecheck를 통과했다.

## 이어받기 상태

- 사용자별 `mcp_tokens` 스키마와 마이그레이션을 추가했다. 원문은 32바이트 난수에 `ezmcp_` 접두어를 붙여 한 번만 반환하고 DB에는 SHA-256만 저장한다.
- 세션 인증 기반 발급·목록·소유자 제한 폐기 API와 `Cache-Control: no-store`를 추가했다. 토큰은 90일 뒤 만료된다.
- 로그인, 사용자 식별·등록, 토큰 발급에 계정·클라이언트 기준 요청 제한을 적용했다. loopback 프록시의 전달 주소만 신뢰한다.
- 사용자 메뉴에 MCP 주소, 일회성 토큰 복사, 목록·최근 사용·폐기, Codex 설정 예시를 제공하는 연결 화면을 추가했다. 원문은 React 일시 상태에만 둔다.
- 직접 실행한 Vitest 단위 검증은 `write-auth.test.ts`, `mcp-token.test.ts`의 5개 테스트를 통과했다. pnpm 실행 shim이 이 환경에서 실행 파일을 찾지 못해 동일한 Vitest 엔트리 파일을 Node로 직접 실행했다.
- 공식 `@modelcontextprotocol/sdk` 1.30.0을 고정하고, 전역 `/api` prefix 밖의 stateless JSON Streamable HTTP `/mcp` endpoint를 추가했다.
- 모든 MCP 요청은 전용 토큰의 해시·만료·폐기·사용자 존재를 먼저 검증한다. SDK의 Host/Origin 재바인딩 보호에는 설정된 공개 URL만 허용한다.
- `list_projects`, `get_project`, `list_review_threads` 조회 도구에 strict 입출력 스키마와 read-only annotation을 추가했다.
- `create_project`, `update_project`, `delete_project`, `create_review_thread`, `reply_review_thread`, `update_review_thread`, `delete_review_thread`를 공통 서비스에 연결했다. 작업자는 입력이 아니라 인증된 토큰 소유자로 고정된다.
- MCP 로그는 인자·결과·헤더·토큰 없이 제한된 메타데이터만 날짜별 JSONL에 기록한다.
- 다음 작업: 프로젝트·리뷰 쓰기 도구와 문서 변경·진단·이력 도구 구현.
- 사용자 소유의 기존 변경 파일은 수정하거나 커밋하지 않는다.
