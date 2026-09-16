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

## 다음 단위

- LAN host script와 환경 예시
- HTTP에서도 항상 작동하는 token 수동 선택·복사 UI
- 직접 LAN 운영 문서와 실제 non-loopback HTTP/WS 통합 검증

## 호스팅·UI 변경

- `host:start`와 `host:serve` 경로는 개발 `.env`의 loopback 기본값을 override하고 `0.0.0.0`에 bind한다. 시작 시 loopback health URL, LAN 후보 주소, 허용 CIDR과 MCP URL을 표시한다.
- `.env.example`에 `LAN_ALLOWED_CIDRS`와 사설 IPv4 MCP URL 형식을 추가했다.
- 비보안 HTTP에서도 사용할 수 있도록 발급 token을 읽기 전용 input에 표시하고 발급 직후 전체 선택한다. Clipboard API가 없거나 실패하면 입력란을 다시 선택하고 `Ctrl+C` 수동 복사 안내를 표시한다.
- 동기화 히스토리의 변경 내용 복사도 Clipboard API 실패 시 선택 가능한 읽기 전용 textarea와 `Ctrl+C` 안내를 표시한다.
- 기본 운영 문서를 별도 도메인·TLS·proxy가 없는 직접 LAN HTTP 절차로 교체했다. 이전 Caddy 예시는 제거했다.
