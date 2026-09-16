# 사내 LAN HTTPS 호스팅

웹·API·MCP는 하나의 NestJS 프로세스에서 `127.0.0.1:3001`로 실행한다. LAN에는 TLS reverse proxy의 443만 노출한다. PostgreSQL도 Compose 설정대로 loopback에만 바인딩한다.

## 준비

사내 DNS 이름, 클라이언트가 신뢰하는 인증서와 개인 키, 실제 사내 CIDR을 준비한다. 사내 CA 인증서라면 웹 브라우저와 MCP 클라이언트가 실행되는 OS의 신뢰 저장소에 CA를 설치한다. 인증서 검증을 끄지 않는다.

`.env`에 다음 값을 설정한다.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
MCP_ENABLED=true
MCP_PUBLIC_URL=https://ezerd.example.internal/mcp
MCP_LOG_DIR=.data/logs/mcp
```

`MCP_PUBLIC_URL`은 사용자 정보, query, fragment가 없는 정확한 HTTPS `/mcp` 주소여야 한다. `http`는 production에서 거부된다.

## Caddy reverse proxy

[`deploy/Caddyfile.example`](../../deploy/Caddyfile.example)을 운영 PC의 Caddy 설정으로 복사하고 다음 환경변수를 실제 값으로 지정한다.

- `EZERD_HOSTNAME`: `ezerd.example.internal` 같은 사내 DNS 이름
- `EZERD_TLS_CERT`, `EZERD_TLS_KEY`: 인증서와 키의 절대 경로
- `EZERD_ALLOWED_CIDRS`: 보안 담당자가 승인한 하나 이상의 사내 CIDR. 전체 허용 값을 사용하지 않는다.

예시는 proxy access log를 끈다. 현재 웹 WebSocket 인증은 URL query를 사용하므로 query string을 기록하는 기본 access log를 켜지 않는다. MCP 애플리케이션 로그는 `.data/logs/mcp/YYYY-MM-DD.jsonl`에 request ID, 사용자·토큰 레코드 ID, 도구명, 처리 시간과 상태만 기록한다.

Caddy는 인증서 파일과 443 포트를 읽을 계정으로 실행한다. `reverse_proxy`는 WebSocket upgrade를 전달하며 `flush_interval -1`로 MCP 응답 buffering을 방지한다. 실제 클라이언트에서 initialize, tools/list, 읽기·쓰기 호출을 확인한다.

환경변수를 설정한 같은 PowerShell에서 구성을 검사하고 proxy를 실행한다.

```powershell
caddy validate --config deploy/Caddyfile.example --adapter caddyfile
caddy run --config deploy/Caddyfile.example --adapter caddyfile
```

`pnpm host:start`는 loopback 앱을 실행하며 Caddy를 대신 시작하지 않는다. 앱과 Caddy는 각각의 터미널 또는 운영 서비스 관리자로 실행한다.

## 호스트 방화벽

Windows 관리자 PowerShell에서 조직이 승인한 CIDR을 사용해 443 inbound 규칙을 만든다. 아래 값은 설명용 placeholder이며 그대로 실행하지 않는다.

```powershell
New-NetFirewallRule -DisplayName 'EZERD HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress '<approved-cidr-1>','<approved-cidr-2>'
```

3001과 PostgreSQL 포트의 LAN inbound 허용 규칙은 만들지 않는다. 기존 직접 노출 규칙이 있으면 운영 담당자가 제거한다. 앱과 DB가 `127.0.0.1`에서만 listen하는지 `Get-NetTCPConnection -State Listen`으로 확인한다.

## 실행과 확인

```powershell
pnpm setup
pnpm db:up
pnpm host:start
```

이미 빌드와 마이그레이션이 끝났으면 `pnpm host:serve`를 사용한다. 스크립트는 방화벽이나 인증서를 변경하지 않으며 loopback upstream과 설정된 MCP 공개 주소만 표시한다.

검증 순서는 다음과 같다.

1. 호스팅 PC에서 `http://127.0.0.1:3001/api/health/ready`가 ready인지 확인한다.
2. 다른 사내 장치에서 `https://<사내 DNS>/api/health/ready`와 웹 화면을 확인한다.
3. 외부 CIDR 또는 격리된 테스트 장치에서 443 접속이 거부되는지 확인한다.
4. 다른 장치에서 3001과 PostgreSQL 포트에 직접 접속할 수 없는지 확인한다.
5. 웹 사용자 메뉴에서 MCP 토큰을 발급해 client 환경변수에 넣고 조회·쓰기를 실행한다.
6. 토큰을 폐기한 뒤 다음 MCP 요청이 401인지 확인하고 새 토큰으로 교체한다.

Codex 설정 예시는 다음과 같다.

```toml
[mcp_servers.ezerd]
url = "https://ezerd.example.internal/mcp"
bearer_token_env_var = "EZERD_MCP_TOKEN"
default_tools_approval_mode = "writes"
tool_timeout_sec = 60
```

`EZERD_MCP_TOKEN`은 Codex가 실행되는 사용자 환경에만 둔다. 서버 `.env`, 저장소, 채팅에는 넣지 않는다. PIN은 MCP 설정에 사용하지 않는다.

Windows에서 사용자 환경변수로 저장하려면 값 부분에 웹에서 한 번 표시된 토큰을 직접 넣는다.

```powershell
[Environment]::SetEnvironmentVariable('EZERD_MCP_TOKEN', '<issued-token>', 'User')
```

Codex를 완전히 종료한 뒤 다시 실행해야 새 사용자 환경변수를 읽는다. `$env:EZERD_MCP_TOKEN = '<issued-token>'`은 현재 PowerShell 프로세스와 그 자식에만 유효하므로, 그 터미널에서 Codex를 실행할 때만 전달된다. 토큰을 폐기하거나 재발급하면 사용자 환경변수를 새 값으로 교체하고 Codex를 다시 시작한다.

## 데이터와 검증 범위

프로젝트는 `.data/postgres`의 PostgreSQL에 저장된다. MCP 로그에는 업무 데이터 원문, PIN, 세션·MCP 토큰, token hash, Authorization header, DB URL과 오류 stack을 기록하지 않는다. 운영 백업과 로그 보존 기간은 조직 정책에 맞게 별도로 설정한다.

로컬 PostgreSQL·HTTP·SDK 검증은 배포 전 회귀를 확인한다. 실제 HTTPS 인증서 신뢰, 다른 장치의 사내 CIDR 허용·외부 대역 차단, 3001 직접 접근 차단과 원격 Codex 연결은 운영 네트워크에서 별도로 수행해야 한다.
