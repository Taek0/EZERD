# MCP 사내 LAN 호스팅 구현 기록

작성일: 2026-09-17

## 공통 서비스 경계

- 프로젝트 CRUD를 `WorkspaceService`로 분리하고 REST 컨트롤러의 기존 세션 인증 순서를 유지했다.
- 리뷰 조회·생성·답글·수정·삭제와 알림 처리를 `ReviewService`로 분리했다.
- 리뷰 쓰기는 기존 트랜잭션 잠금·검증을 그대로 사용하며, WebSocket 이벤트는 트랜잭션 커밋 뒤에 발행한다.
- 서버 TypeScript typecheck를 통과했다.

## 구현 및 검증

- 사용자별 `mcp_tokens` 스키마와 마이그레이션을 추가했다. 원문은 32바이트 난수에 `ezmcp_` 접두어를 붙여 한 번만 반환하고 DB에는 SHA-256만 저장한다.
- 세션 인증 기반 발급·목록·소유자 제한 폐기 API와 `Cache-Control: no-store`를 추가했다. 토큰은 90일 뒤 만료된다.
- 로그인, 사용자 식별·등록, 토큰 발급에 계정·클라이언트 기준 요청 제한을 적용했다. loopback 프록시의 전달 주소만 신뢰한다.
- 사용자 메뉴에 MCP 주소, 일회성 토큰 복사, 목록·최근 사용·폐기, Codex 설정 예시를 제공하는 연결 화면을 추가했다. 원문은 React 일시 상태에만 둔다.
- 직접 실행한 Vitest 단위 검증은 `write-auth.test.ts`, `mcp-token.test.ts`의 5개 테스트를 통과했다. pnpm 실행 shim이 이 환경에서 실행 파일을 찾지 못해 동일한 Vitest 엔트리 파일을 Node로 직접 실행했다.
- 공식 `@modelcontextprotocol/sdk` 1.30.0을 고정하고, 전역 `/api` prefix 밖의 stateless JSON Streamable HTTP `/mcp` endpoint를 추가했다.
- 모든 MCP 요청은 전용 토큰의 해시·만료·폐기·사용자 존재를 먼저 검증한다. SDK의 Host/Origin 재바인딩 보호에는 설정된 공개 URL만 허용한다.
- `list_projects`, `get_project`, `list_review_threads` 조회 도구에 strict 입출력 스키마와 read-only annotation을 추가했다.
- `create_project`, `update_project`, `delete_project`, `create_review_thread`, `reply_review_thread`, `update_review_thread`, `delete_review_thread`를 공통 서비스에 연결했다. 작업자는 입력이 아니라 인증된 토큰 소유자로 고정된다.
- `diagnose_project`, `apply_project_changes`, `get_project_history`, `undo_project_operation`, `restore_project_deletion`을 추가했다.
- 문서 변경은 자유 형식 patch 대신 도메인·테이블·컬럼·키·관계·노트의 strict discriminated union을 사용한다. 호출자가 확인한 project version과 sync sequence가 모두 일치할 때만 reconnect 기준을 발급한다.
- MCP 문서 변경의 idempotency fingerprint는 서버가 새로 발급하는 baseline이 아니라 사용자의 고수준 명령으로 계산한다. 같은 operation ID 재요청은 작업자와 fingerprint가 모두 일치할 때만 저장 결과를 반환한다.
- 운영 앱과 PostgreSQL은 loopback에만 바인딩하고, Caddy 예시는 TLS 443, 명시적 사내 CIDR, streaming, access log 비활성화를 적용한다. 방화벽·인증서는 자동 변경하지 않는다.
- Windows Codex 사용자 환경변수 설정, 현재 PowerShell에만 적용되는 `$env:` 범위, 완전 종료 후 재시작과 Caddy validate/run 절차를 운영 문서에 기록했다.
- MCP 로그는 인자·결과·헤더·토큰 없이 제한된 메타데이터만 날짜별 JSONL에 기록한다.
- 사용자 소유의 기존 변경 파일은 수정하거나 커밋하지 않는다.

## 최종 검증 결과

- `node node_modules/prettier/bin/prettier.cjs --check .`: 통과
- `pnpm typecheck`: 전체 workspace 통과
- `node node_modules/vitest/vitest.mjs run`: 60개 파일, 297개 테스트 통과. DB opt-in 3개 파일, 22개 테스트는 기본 실행에서 skip
- 독립 임시 PostgreSQL 생성 → 전체 마이그레이션 → API·WebSocket·MCP 통합: 3개 파일, 22개 테스트 통과 후 임시 DB 삭제
- MCP 통합에서 15개 도구의 실제 Streamable HTTP 호출, 두 사용자 작업자 기록, stale version/sequence, operation replay·변조, 다른 사용자 undo 거부, 삭제 복원, 토큰 소유권·hash·만료·폐기, 웹 세션/MCP 토큰 인증 경계와 잘못된 Origin 거부를 확인했다.
- `pnpm build`: 서버와 웹 production build 통과. Vite의 기존 500 kB 이상 chunk 경고가 있으며 build 실패는 아니다.
- 격리된 로컬 서버의 브라우저 QA에서 토큰 발급·복사 피드백·재열기 시 원문 비노출·폐기와 console 오류 없음이 확인됐다.
- 로컬 SDK HTTP QA에서 initialize, tools/list, 조회 호출, 폐기 후 401을 확인했다. 애플리케이션 JSONL에는 허용된 메타데이터만 있고 토큰·Authorization·PIN·hash가 없음을 확인했다.
- Caddy 2의 격리된 config adapter 검증에서 443만 사용, HTTP redirect 비활성화, 허용 CIDR handle과 기본 403, access log 폐기, upstream buffering 비활성화 구성이 확인됐다. 인증서 로딩과 실제 TLS handshake는 이 검증에 포함하지 않았다.

실제 사내 DNS·인증서 신뢰, 방화벽 CIDR, 다른 장치의 HTTPS·Codex 연결, 허용 대역 밖 차단과 3001 직접 접근 차단은 운영 네트워크에서 수행해야 한다.
