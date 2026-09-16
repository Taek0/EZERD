# MCP 직접 LAN HTTP 호스팅 변경 계획

작성일: 2026-09-17
상태: 구현 전 계획

## 변경 목표

초기 운영은 사내 DNS·인증서·TLS reverse proxy 없이 호스팅 PC의 사설 IPv4와 포트로 웹·API·MCP를 직접 제공한다. `pnpm host:start`와 `pnpm host:serve`는 production 앱을 LAN 주소에 bind하며, 개발 기본값 `127.0.0.1`은 유지한다.

MCP 사용자별 전용 토큰, hash 저장, 만료·폐기, 작업자 기록과 동시성 규칙은 유지한다. 사내 HTTP 사용은 이번 운영 선택이며 인터넷·공용 Wi-Fi 노출은 지원하지 않는다.

## 네트워크 경계

- `HOST=0.0.0.0` 또는 특정 LAN 인터페이스로 production을 실행할 때 `LAN_ALLOWED_CIDRS`를 반드시 지정한다.
- `LAN_ALLOWED_CIDRS`는 쉼표로 구분한 유효한 IPv4 CIDR 목록이며 빈 값, 잘못된 값, 전체 허용 대역은 startup에서 거부한다.
- 앱의 가장 앞단 middleware가 실제 socket `remoteAddress`를 CIDR과 비교해 웹 정적 파일, API, `/mcp` 전체를 차단한다.
- `X-Forwarded-For`, `Forwarded` 등 전달 헤더를 신뢰하지 않는다. 기존 loopback proxy trust 설정을 제거한다.
- IPv4-mapped IPv6 주소는 동일 IPv4로 정규화한다. loopback은 호스팅 PC의 health check와 로컬 QA를 위해 허용한다.
- WebSocket upgrade는 HTTP middleware를 거치지 않으므로 `SyncGateway`의 upgrade handler에서도 같은 정책을 먼저 검사한다.
- 허용되지 않은 연결은 HTTP 403, WebSocket socket 종료로 fail closed 한다.

## MCP 주소와 Host·Origin

- production에서 `MCP_PUBLIC_URL=http://<private-lan-ip>:<port>/mcp`를 허용한다.
- HTTP MCP 주소는 RFC1918 사설 IPv4 또는 loopback만 허용하며 외부 IPv4, hostname, 사용자 정보, query, fragment, `/mcp` 외 경로는 거부한다.
- `MCP_PUBLIC_URL`의 port는 앱 `PORT`와 일치해야 한다.
- MCP SDK Host/Origin 보호는 설정된 IP와 port를 그대로 사용한다. Origin이 없는 native client는 허용하되, 브라우저 Origin이 있으면 설정 주소만 허용한다.

## 사용자 흐름

- 브라우저가 `http://<LAN-IP>:<PORT>`로 접속한다.
- 사용자 메뉴의 MCP 화면은 `http://<LAN-IP>:<PORT>/mcp`를 보여 준다.
- 비보안 HTTP에서는 Clipboard API가 제한될 수 있으므로 토큰 원문은 선택 가능한 입력 또는 textarea로 표시하고 수동 복사 안내를 항상 제공한다.
- PIN과 MCP 토큰을 채팅이나 서버 `.env`에 넣지 않는 기존 안내를 유지한다.

## 설정과 실행

예시 값은 placeholder이며 실제 사내 주소를 추정하지 않는다.

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
LAN_ALLOWED_CIDRS=<office-private-cidr>
MCP_ENABLED=true
MCP_PUBLIC_URL=http://<host-private-ip>:3001/mcp
MCP_LOG_DIR=.data/logs/mcp
```

개발 실행은 `.env`의 `HOST`를 존중한다. 전용 `host:start`와 `host:serve` 명령은 개발용 loopback 기본값과 혼동되지 않도록 production에서 명시적으로 `0.0.0.0`을 사용한다. 방화벽은 자동 변경하지 않는다.

## 구현 단위

1. IPv4/CIDR parser·config 검증과 앱 전체 HTTP guard
2. WebSocket upgrade guard와 spoofed forwarding-header 회귀 검증
3. private IPv4 HTTP MCP URL·port 검증과 Host/Origin 회귀 검증
4. 직접 LAN host script, 환경 예시, 수동 토큰 복사 UI, 운영 문서 갱신
5. unit·실제 HTTP/WS·독립 PostgreSQL 통합, 전체 format/typecheck/test/build 검증

각 단위는 독립 검증 후 커밋한다. 실제 사내 장치 연결과 방화벽 검증은 운영 환경에서 수행한다.
