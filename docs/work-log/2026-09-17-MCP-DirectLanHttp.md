# MCP 직접 LAN HTTP 구현 기록

작성일: 2026-09-17

## 네트워크 경계와 설정

- RFC1918 IPv4 CIDR만 허용하는 `LAN_ALLOWED_CIDRS` parser와 Node `BlockList` 기반 판정기를 추가했다.
- production에서 non-loopback 주소에 bind할 때 비어 있거나 잘못된 CIDR 설정을 startup에서 거부한다. 전체 허용·외부 IPv4 CIDR도 거부한다.
- IPv4, IPv4-mapped IPv6, loopback을 동일 정책으로 판정하며 실제 socket 주소만 사용한다.
- Nest 기본 body parser를 끄고 네트워크 guard를 제한된 JSON parser와 정적 파일보다 먼저 등록했다. `trust proxy`는 false라 전달 헤더를 클라이언트 주소로 사용하지 않는다.
- WebSocket upgrade도 세션 token 인증 전에 같은 네트워크 guard를 통과한다.
- production MCP URL은 앱 PORT와 일치하는 RFC1918·loopback HTTP `/mcp` 주소를 허용한다. 외부 HTTP, hostname HTTP, 잘못된 port, 사용자 정보, query와 fragment는 거부한다.

## 검증

- server typecheck 통과
- `network-access.test.ts`, `mcp-security.test.ts`, `mcp-server.test.ts`: 3개 파일, 8개 테스트 통과
- 유효 RFC1918 범위, invalid CIDR, IPv4-mapped IPv6 두 표기, forwarding header spoof 무시, WebSocket guard의 auth 선행 차단을 검증했다.

## 호스팅·UI 변경

- `host:start`와 `host:serve` 경로는 개발 `.env`의 loopback 기본값을 override하고 `0.0.0.0`에 bind한다. 시작 시 loopback health URL, LAN 후보 주소, 허용 CIDR과 MCP URL을 표시한다.
- `.env.example`에 `LAN_ALLOWED_CIDRS`와 사설 IPv4 MCP URL 형식을 추가했다.
- 비보안 HTTP에서도 사용할 수 있도록 발급 token을 읽기 전용 input에 표시하고 발급 직후 전체 선택한다. Clipboard API가 없거나 실패하면 입력란을 다시 선택하고 `Ctrl+C` 수동 복사 안내를 표시한다.
- 동기화 히스토리의 변경 내용 복사도 Clipboard API 실패 시 선택 가능한 읽기 전용 textarea와 `Ctrl+C` 안내를 표시한다.
- 기본 운영 문서를 별도 도메인·TLS·proxy가 없는 직접 LAN HTTP 절차로 교체했다. 이전 Caddy 예시는 제거했다.

## 최종 검증

- `pnpm format:check`: 통과
- `pnpm typecheck`: 전체 workspace 통과
- 전체 unit suite: 61개 파일, 302개 테스트 통과. DB opt-in 3개 파일, 22개 테스트는 기본 실행에서 skip
- `pnpm build`: server·web production build 통과. 기존 Vite 대형 chunk 경고만 발생
- 독립 임시 PostgreSQL 생성 → 전체 migration → API·WebSocket·MCP 통합: 3개 파일, 22개 테스트 통과 후 임시 DB 삭제
- CIDR이 빈 production LAN 실행은 server listen 전에 `LAN_ALLOWED_CIDRS` 설정 이름만 포함한 오류로 fail closed됨을 확인
- 실제 호스팅 PC의 사설 인터페이스를 임시 `/32` test 설정으로 검증했다. 불허 CIDR에서는 정적 `/`, API, `/mcp`, malformed JSON을 모두 403으로 차단했고 WebSocket은 인증 전에 종료했다. 위조한 `X-Forwarded-For`와 `Forwarded`는 무시됐다.
- 허용 CIDR에서는 사설 IPv4의 정적 페이지와 API가 200, 인증 WebSocket upgrade가 성공했다.
- production 사설 IPv4 HTTP에서 MCP SDK initialize, 15개 tools/list, list_projects를 확인했고 token 폐기 다음 요청은 401이었다.
- 실제 사설 IPv4 브라우저에서 MCP panel의 HTTP URL, token 발급, 읽기 전용 입력란 전체 선택, 복사 피드백, 폐기와 console 오류·경고 없음을 확인했다. Clipboard API가 없는 경우의 수동 input/textarea 분기는 source와 unit 회귀로 확인했다.

위 실제 인터페이스 검증은 임시 test port·격리 DB에서 수행했으며 사용자의 `.env`, 방화벽과 기존 데이터를 변경하지 않았다. 다른 사내 장치와 실제 운영 방화벽의 허용·차단 검증은 배포 시 남아 있다.
