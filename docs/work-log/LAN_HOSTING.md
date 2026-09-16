# 사내 LAN HTTP 직접 호스팅

초기 운영은 별도 도메인·인증서·reverse proxy 없이 호스팅 PC의 사설 IPv4와 포트로 웹·API·MCP를 함께 제공한다. `pnpm host:start`와 `pnpm host:serve`는 앱을 `0.0.0.0`에 bind하지만, 앱의 네트워크 guard가 `LAN_ALLOWED_CIDRS`에 지정한 사내 IPv4 대역과 호스팅 PC의 loopback만 허용한다. PostgreSQL은 계속 `127.0.0.1`에만 bind한다.

HTTP에서 사용자 세션과 MCP token이 전달되므로 신뢰할 수 있는 사내 유선망·Wi-Fi에서만 사용한다. 인터넷, guest Wi-Fi, port forwarding과 공용망에는 노출하지 않는다.

## 사설 IPv4와 CIDR 확인

호스팅 PC의 PowerShell에서 IPv4를 확인한다.

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }
```

실제 서비스에 사용할 사설 IPv4와 조직이 승인한 가장 좁은 CIDR을 네트워크 담당자에게 확인한다. 아래 문서의 `192.168.1.20`과 `192.168.1.0/24`는 형식 설명용 placeholder다. 실제 환경을 추정한 값이 아니다.

## 환경 설정

`.env`의 개발 기본 `HOST=127.0.0.1`은 그대로 둘 수 있다. 전용 LAN 명령이 production에서 `0.0.0.0`으로 override한다. 다음 MCP·LAN 값을 실제 사설 주소로 설정한다.

```dotenv
PORT=3001
LAN_ALLOWED_CIDRS=192.168.1.0/24
MCP_ENABLED=true
MCP_PUBLIC_URL=http://192.168.1.20:3001/mcp
MCP_LOG_DIR=.data/logs/mcp
```

- `LAN_ALLOWED_CIDRS`는 쉼표로 여러 RFC1918 IPv4 CIDR을 지정할 수 있다.
- 빈 값, 잘못된 CIDR, 외부 IPv4 CIDR과 `0.0.0.0/0`은 production LAN startup에서 거부된다.
- `MCP_PUBLIC_URL`은 호스팅 PC의 RFC1918 IPv4, 앱 `PORT`, 정확한 `/mcp` 경로를 사용한다. hostname HTTP, 외부 IPv4, 다른 port, 사용자 정보, query와 fragment는 거부된다.
- 앱은 실제 TCP socket 주소만 검사한다. `X-Forwarded-For`와 `Forwarded` header로 허용 대역을 위조할 수 없다.

## 실행

```powershell
pnpm setup
pnpm db:up
pnpm host:start
```

`host:start`는 build, DB migration, LAN 실행을 순서대로 수행한다. build와 migration이 준비되어 있으면 다음 명령을 사용한다.

```powershell
pnpm host:serve
```

출력에는 loopback health URL, 발견한 LAN 후보 URL, 허용 CIDR과 MCP 공개 URL이 나온다. `LAN_ALLOWED_CIDRS`가 없거나 유효하지 않으면 외부 연결을 열기 전에 종료한다. 스크립트는 `.env`, 방화벽과 네트워크 설정을 변경하지 않는다.

## Windows 방화벽

방화벽 변경이 필요하면 관리자와 승인된 CIDR을 확인한 후 앱 port만 허용한다. 아래 값은 placeholder라 그대로 실행하지 않는다.

```powershell
New-NetFirewallRule -DisplayName 'EZERD LAN HTTP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -RemoteAddress '<approved-private-cidr>'
```

PostgreSQL port는 LAN에 허용하지 않는다. 방화벽과 앱 guard를 같은 CIDR로 맞춘다.

## 웹과 MCP 연결

다른 허용 장치에서 `http://<host-private-ip>:<port>`를 연다. 사용자 메뉴의 MCP 연결 화면에서 90일 개인 token을 발급한다. HTTP 페이지에서는 Clipboard API가 차단될 수 있으므로 token은 읽기 전용 입력란에 표시되고 자동으로 선택된다. 자동 복사가 실패하면 입력란을 클릭하고 `Ctrl+C`로 복사한다. 원문은 화면을 닫으면 다시 조회할 수 없다.

Codex 설정 예시는 다음과 같다.

```toml
[mcp_servers.ezerd]
url = "http://192.168.1.20:3001/mcp"
bearer_token_env_var = "EZERD_MCP_TOKEN"
default_tools_approval_mode = "writes"
tool_timeout_sec = 60
```

Windows 사용자 환경변수에 저장하려면 발급 화면의 값을 직접 넣는다.

```powershell
[Environment]::SetEnvironmentVariable('EZERD_MCP_TOKEN', '<issued-token>', 'User')
```

Codex를 완전히 종료한 뒤 다시 실행해야 사용자 환경변수를 읽는다. `$env:EZERD_MCP_TOKEN = '<issued-token>'`은 현재 PowerShell과 그 자식 프로세스에만 적용된다. PIN은 MCP 설정에 사용하지 않는다. token을 서버 `.env`, 저장소 또는 채팅에 넣지 않는다.

## 검증

1. 호스팅 PC에서 `http://127.0.0.1:3001/api/health/ready`가 ready인지 확인한다.
2. 허용 CIDR의 다른 장치에서 `http://<host-private-ip>:3001/api/health/ready`와 웹을 확인한다.
3. 허용되지 않은 사내 대역 또는 격리 장치에서 HTTP와 WebSocket 연결이 403 또는 연결 종료되는지 확인한다.
4. `X-Forwarded-For`를 허용 IP로 보내도 차단이 유지되는지 확인한다.
5. 개인 token으로 MCP initialize, tools/list, 조회·쓰기를 확인하고 token 폐기 후 다음 요청이 401인지 확인한다.
6. 다른 장치에서 PostgreSQL port에 직접 접속할 수 없는지 확인한다.

로컬 자동 검증은 parser·guard·실제 HTTP/WS·PostgreSQL 회귀를 확인한다. 실제 사내 장치와 방화벽 검증은 운영 네트워크에서 수행해야 한다.

## HTTPS 후속 전환

HTTPS가 필요해지면 인증서와 reverse proxy를 별도 운영 변경으로 준비한다. 현재 직접 HTTP 실행 명령은 TLS를 종료하지 않으며 이 문서는 HTTPS 배포를 완료했다고 가정하지 않는다.
