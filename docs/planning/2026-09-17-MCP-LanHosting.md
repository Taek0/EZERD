# MCP 사내 LAN 호스팅 구현 계획

작성일: 2026-09-17
상태: 기존 HTTPS proxy안 구현 완료 후 운영 방향 변경. 직접 LAN HTTP 기준은 `2026-09-17-MCP-DirectLanHttp.md`로 대체

> 이 문서는 현재 운영 기준이 아니다. 도메인·TLS proxy 없이 사설 IPv4 HTTP로 직접 실행하는 최신 정책과 설정은 [`2026-09-17-MCP-DirectLanHttp.md`](./2026-09-17-MCP-DirectLanHttp.md)를 따른다.

## 목표와 설계 결정

EZERD의 기존 NestJS 서버에 Streamable HTTP MCP endpoint를 추가한다. 사용자는 웹에서 기존 계정으로 로그인해 MCP 전용 토큰을 발급하고, 사내 MCP 클라이언트에 주소와 토큰을 한 번 설정한다. 이후 프로젝트 조회·생성·수정, 리뷰, ERD 문서 변경을 자연어로 요청하며 변경 이력에는 해당 사용자를 기록한다.

구현 단순화를 위해 사용자별 전용 Bearer 토큰과 같은 프로세스의 서비스 호출을 채택한다. 기존 계획의 별도 `apps/mcp`, 공용 내부 사용자, 내부 HTTP API 클라이언트와 세션 갱신은 제거한다. OAuth와 브라우저 연결 승인 화면은 후속 범위다. 초기 지원 대상은 사용자 지정 Bearer 토큰과 Streamable HTTP를 지원하는 클라이언트다.

```text
사내 MCP 클라이언트 / 웹 브라우저
        │ HTTPS, 사내 주소:443
        ▼
TLS 리버스 프록시 + 사내 접근 대역 제한
        │ loopback HTTP
        ▼
기존 NestJS 127.0.0.1:3001
        ├── /mcp       → MCP 토큰 인증 → 도구 어댑터
        ├── /api      → 기존 웹 세션 인증 → REST controller
        └── React 정적 파일
                          │
                          ▼
                  공통 서비스와 동기화 로직
                          │
                          ▼
              PostgreSQL 127.0.0.1:55432
```

MCP와 웹/API가 같은 프로세스이므로 MCP의 프로세스 수준 장애는 웹/API에도 영향을 줄 수 있다. 초기에는 이 절충을 수용하고 도구별 오류 처리와 요청 크기·처리 시간 제한을 적용한다. 독립 프로세스 운영은 필요해질 때 검토한다.

## 확정 정책

- MCP endpoint는 API 전역 prefix와 분리한 `/mcp`이며 별도 3002 포트를 열지 않는다.
- 읽기 도구와 초기화를 포함한 모든 MCP 요청에 유효한 MCP 전용 토큰을 요구한다.
- 사용자별 토큰은 웹 로그인 세션과 별도 수명주기로 관리한다. 브라우저 세션 토큰을 복사하거나 MCP 인증에 재사용하지 않는다.
- 최초 버전의 토큰은 해당 사용자가 기존 서비스에서 수행할 수 있는 작업 범위를 따른다. 별도 역할·scope 체계는 추가하지 않으며, 사용자 식별이 프로젝트별 권한 분리를 자동으로 제공한다고 가정하지 않는다.
- 모든 계획된 도구를 등록하고 `readOnlyHint`, `destructiveHint`, `openWorldHint`는 실제 동작에 맞게 설정한다. 클라이언트 승인 설정은 서버 인증·권한 검사의 대체물이 아니다.
- 기존 데이터 검증, 보관·삭제 규칙, 작업자 검사, 트랜잭션과 동시성 보호를 공통 서비스에서 유지한다.
- MCP 도구 어댑터는 DB를 직접 수정하지 않는다. 공통 서비스와 토큰 저장소만 기존 DB 계층을 사용한다.
- 인증정보와 업무 데이터 원문은 로그에 기록하지 않는다. 외부 로그 수집과 알림 시스템은 구축하지 않는다.

## 사용자 연결 흐름

1. 사용자가 EZERD 웹에서 기존 사용자명·PIN 방식으로 로그인한다.
2. 설정의 MCP 연결 화면에서 토큰 이름을 입력하고 발급한다.
3. 서버는 토큰 원문을 발급 응답으로 한 번만 반환한다. 화면은 MCP 주소, 토큰 복사, 클라이언트 설정 예시와 만료일을 표시한다.
4. 사용자는 자신의 클라이언트 실행 환경에 토큰을 저장하고 MCP 주소를 등록한다. PIN이나 토큰을 채팅으로 입력하게 하지 않는다.
5. 연결 후 도구를 호출하면 토큰 소유자가 실제 작업자로 기록된다.
6. 만료되거나 노출된 토큰은 웹에서 폐기하고 새 토큰을 발급해 클라이언트 설정을 교체한다.

자동 갱신과 refresh token은 구현하지 않는다. 웹에는 본인의 토큰 이름, 생성일, 만료일, 마지막 사용일과 폐기 기능만 제공하며 원문 재조회는 제공하지 않는다.

## 토큰 저장과 인증

기존 `sessions` 테이블과 별도로 `mcp_tokens`를 추가한다.

- `id`, `userId`, `name`, `tokenHash`, `createdAt`, `expiresAt`, `revokedAt`, `lastUsedAt`
- 암호학적으로 안전한 32바이트 이상 난수로 원문을 생성하고 MCP 전용 접두어를 붙인다.
- DB에는 SHA-256 해시만 저장하고 `tokenHash`에 unique index를 둔다. 원문은 발급 시에만 반환한다.
- 초기 유효기간은 발급 시점부터 90일로 고정하며 무기한 토큰은 제공하지 않는다.
- 관리 API는 `POST /api/mcp-tokens`, `GET /api/mcp-tokens`, `DELETE /api/mcp-tokens/:id`로 구성한다. 기존 웹 세션 인증을 요구하고 목록·폐기 대상을 세션 사용자로 제한한다.
- 발급 응답에는 `Cache-Control: no-store`를 적용한다. 웹은 토큰 원문을 localStorage/sessionStorage에 저장하지 않고 발급 화면의 일시적 상태로만 유지한다.
- MCP는 매 요청의 `Authorization: Bearer ...`에서 토큰을 확인하고 해시, 만료, 폐기 상태와 사용자 존재 여부를 DB에서 검증한다. 잘못된 토큰은 도구 실행 전에 HTTP 401로 거부한다.
- 조회한 사용자로 서버 내부 작업자 정보를 구성한다. 도구 입력의 사용자 ID로 작업자를 선택하거나 바꿀 수 없게 한다.
- stateless Streamable HTTP를 우선 사용한다. SDK상 세션이 필요하면 세션을 토큰 소유자와 연결하고 매 요청 인증을 유지한다. MCP 세션 ID 자체를 인증 수단으로 사용하지 않는다.
- 폐기·만료는 다음 요청부터 적용하며 이미 실행 중인 트랜잭션을 강제 취소하지 않는다.

토큰을 발급하는 웹 로그인에는 기존 PIN 검증을 재사용하되 로그인과 발급 경로의 요청 빈도를 제한한다. PIN 자체를 MCP 설정에 저장하는 방식은 사용하지 않는다.

## 애플리케이션 구조

```text
apps/server/src/mcp/
├── mcp.module.ts               # 기존 서버 모듈에 등록
├── mcp.controller.ts           # /mcp transport와 요청 처리
├── mcp-server.ts               # instructions, 도구 등록
├── mcp-auth.service.ts         # 토큰 검증과 작업자 구성
├── mcp-token.controller.ts     # 웹 세션 기반 발급·목록·폐기
├── mcp-token.service.ts        # 해시 저장과 소유자 검사
├── logging.ts                 # JSONL 기록과 민감정보 정제
└── tools/
    ├── projects.ts
    ├── reviews.ts
    └── document.ts
```

이는 예정 구조이며 SDK transport와 NestJS adapter의 통합 방식은 첫 구현에서 확인한다. 기존 controller에 비즈니스 로직이 있다면 필요한 부분만 공통 서비스로 추출하고 REST와 MCP 양쪽에서 호출한다. 전체 서버 재구성은 하지 않는다.

`@ezerd/contracts`의 입출력 스키마, `@ezerd/model`의 진단·의미 변경 계산, 기존 동기화 서비스를 재사용한다. MCP가 기존 REST endpoint를 내부 HTTP로 호출하거나 공용 계정으로 로그인하지 않는다. 기존 웹 세션 인증을 MCP 토큰 인증으로 대체하거나 완화하지 않는다.

## 도구 설계

### 프로젝트

- `list_projects`: 상태와 검색어로 프로젝트 목록 조회
- `get_project`: 프로젝트 메타데이터와 현재 설계 문서 조회
- `create_project`: 프로젝트 생성
- `update_project`: 현재 `expectedVersion` 기준 이름·보관 상태 변경
- `delete_project`: 보관된 프로젝트의 최신 버전 영구 삭제

### 리뷰

- `list_review_threads`: 프로젝트의 핀과 답글 조회
- `create_review_thread`: 리뷰 핀과 첫 메시지 생성
- `reply_review_thread`: 기존 핀에 답글 추가
- `update_review_thread`: 기존 계약이 허용하는 상태·위치 등 수정
- `delete_review_thread`: 최신 수정 시각 기준 핀 삭제

### 문서와 진단

- `diagnose_project`: 현재 문서를 진단하고 구조화된 문제 반환
- `apply_project_changes`: 고수준 변경 요청을 기존 동기화 operation으로 원자적 반영
- `get_project_history`: 기존 동기화 이력 조회
- `undo_project_operation`: 기존 서버 규칙에 따른 승인 작업 실행 취소
- `restore_project_deletion`: 삭제 작업 스냅샷을 새 ID로 복원

`apply_project_changes`는 현재 문서와 동기화 기준을 조회하고 의미 변경을 계산해 기존 operations endpoint와 같은 서비스 경로로 제출한다. 전체 문서 PUT을 추가하지 않는다. 도메인·테이블·컬럼·키·관계·노트의 추가·수정·삭제를 명시적인 discriminated union으로 정의하고 자유 형식 JSON Patch는 사용하지 않는다.

쓰기·삭제 도구는 기존 `expectedVersion`, `expectedUpdatedAt`, operation ID와 동기화 기준을 유지한다. 충돌은 덮어쓰지 않고 재조회가 필요한 오류로 반환한다. 작업 ID를 사용하는 변경은 기존 중복 방지 규칙을 유지하고, 응답 유실 시 결과가 불명확한 쓰기를 자동 재실행하지 않는다.

## 응답과 로그

- 입력과 출력은 공개 계약 스키마로 검증하고 알 수 없는 입력 필드는 거부한다.
- 결과는 `structuredContent`와 짧은 `content`로 제공한다.
- 인증 실패는 transport에서 401로 거부하고, 서비스의 예상 가능한 검증·권한·충돌 오류는 안정적인 도구 오류로 변환한다.
- 예상하지 못한 오류는 일반 메시지와 request ID를 반환하며 정제된 상세 원인은 로컬 로그에만 기록한다.
- 환경변수 값, PIN, 웹 세션 토큰, MCP 토큰, DB URL, Authorization 헤더와 원시 오류 스택은 MCP 응답에 포함하지 않는다. 토큰 원문의 유일한 반환 경로는 인증된 웹 발급 API다.
- 로그는 `.data/logs/mcp/YYYY-MM-DD.jsonl`에 기록한다. 시작·종료, 인증 거부, 토큰 발급·폐기, 도구 성공·실패를 남긴다.
- 필드는 시각, 수준, request ID, 확인된 사용자 ID·토큰 레코드 ID, 도구 이름, 처리 시간, 결과 상태, 오류 코드와 제한된 결과 개수로 한정한다. 토큰 레코드 ID는 토큰 원문과 구분한다.
- tool arguments/results 전체, 문서·리뷰 원문, PIN, 토큰 원문·해시, 헤더 전체와 설정 객체를 기록하지 않는다.

## HTTPS와 사내 접근 제한

초기 운영도 토큰을 전달하므로 TLS를 적용한다. 사내 DNS 이름과 클라이언트가 신뢰하는 인증서를 준비하고, 하나의 리버스 프록시가 웹·API·MCP의 TLS를 종료한다. 사내 CA를 사용한다면 각 클라이언트의 신뢰 저장소 설치 절차를 문서화하고 인증서 검증을 끄도록 안내하지 않는다.

- LAN에 노출되는 포트는 프록시의 443이며 프록시 접근 규칙과 호스트 방화벽을 같은 사내 CIDR로 제한한다.
- NestJS와 PostgreSQL은 loopback에 바인딩해 프록시 우회를 막는다. 기존 3001 직접 LAN 노출은 이 배포 구성에서 닫는다.
- CIDR 검사는 실제 클라이언트 연결을 받는 프록시에서 수행한다. NestJS가 보는 loopback 주소를 사내 IP 검증으로 착각하지 않는다.
- 전달 헤더는 loopback 프록시에서 온 요청에 한해 신뢰하도록 명시적으로 설정한다. 외부가 보낸 `X-Forwarded-For`를 그대로 신뢰하지 않는다.
- 프록시는 Streamable HTTP에 필요한 헤더·스트리밍을 유지하고 버퍼링과 timeout을 검증한다. 액세스 로그에 Authorization 값을 포함하지 않는다.
- MCP의 Host/Origin 검증을 SDK 지침에 맞게 적용한다. 웹의 쿠키나 브라우저 세션만으로 MCP 요청을 허용하지 않는다.
- 개발용 loopback HTTP는 허용하되 실제 LAN 토큰 전달 검증은 HTTPS로 수행한다.

애플리케이션 CIDR 파서와 별도 MCP 네트워크 포트를 추가하지 않는다. 방화벽과 프록시의 실제 사내 CIDR은 배포 시 지정하고 전체 허용 기본 예시를 두지 않는다.

## 설정과 실행

앱 설정은 다음 정도로 제한한다. 기존 서버의 주소·포트 설정은 재사용한다.

```dotenv
MCP_ENABLED=true
MCP_PUBLIC_URL=https://ezerd.example.internal/mcp
MCP_LOG_DIR=.data/logs/mcp
```

위 주소는 예시다. TLS 인증서, 허용 CIDR과 외부 호스트명은 프록시 설정에서 관리한다. 기존 계획의 `MCP_PORT`, `MCP_API_BASE_URL`, `EZERD_MCP_ACTOR_USERNAME`, `EZERD_MCP_ACTOR_PIN`은 추가하지 않는다.

- `pnpm dev`, `pnpm build`, `pnpm host:start`, `pnpm host:serve`의 기존 서버 경로에 MCP를 포함한다.
- 별도 MCP 개발·빌드·시작 프로세스를 추가하지 않는다. Inspector는 검증 절차로 안내한다.
- 호스팅 안내에는 웹 URL과 `/mcp` URL, 프록시 준비·실행 절차를 표시한다. 인증서와 방화벽을 스크립트가 자동 변경하지 않는다.
- 프록시와 PostgreSQL은 운영 전제 조건으로 관리한다. MCP 때문에 두 Node 프로세스의 종료를 연동하는 로직은 추가하지 않는다.

Codex 설정 예시는 다음과 같다.

```toml
[mcp_servers.ezerd]
url = "https://ezerd.example.internal/mcp"
bearer_token_env_var = "EZERD_MCP_TOKEN"
default_tools_approval_mode = "writes"
tool_timeout_sec = 60
```

`EZERD_MCP_TOKEN`은 사용자의 Codex 실행 환경에 설정한다. 호스팅 서버 공용 `.env`나 저장소에 사용자 토큰을 모으지 않는다. 설정 가이드에는 운영체제와 클라이언트 실행 방식별 환경변수 전달 방법을 포함한다. 토큰이 없거나 만료된 경우 웹에서 재발급·설정 교체하도록 안내하며 OAuth 로그인 명령을 안내하지 않는다.

## 구현 단위와 커밋

1. **공통 서비스 경계 정리**
   - REST controller의 필요한 비즈니스 로직만 서비스로 추출한다.
   - 기존 웹 API의 인증·작업자·검증·충돌 동작이 유지되는지 검증하고 독립 커밋한다.
2. **사용자별 토큰과 웹 연결 화면**
   - 마이그레이션, 발급·목록·폐기 API, 인증과 설정 화면을 추가한다.
   - 소유자 제한, 원문 1회 반환, 해시 저장, 만료·폐기, PIN·발급 요청 제한을 검증하고 독립 커밋한다.
3. **NestJS MCP와 조회 도구**
   - SDK 버전을 고정하고 `/mcp`, 토큰 검증, 프로젝트·리뷰 조회를 연결한다.
   - stateless 처리 가능 여부와 실제 Codex Bearer 연결을 검증하고 독립 커밋한다.
4. **프로젝트·리뷰 쓰기 도구**
   - 공통 서비스를 호출하고 사용자별 작업자 기록과 기존 충돌·삭제 규칙을 검증한다.
   - 입출력 스키마와 annotation을 추가하고 독립 커밋한다.
5. **문서 변경·진단·이력 도구**
   - 기존 동기화 서비스와 의미 변경 계산을 재사용한다.
   - 충돌, 중복 operation, undo·restore와 사용자별 작업자 규칙을 검증하고 독립 커밋한다.
6. **로그·HTTPS 운영과 최종 검증**
   - 로그 정제, 프록시 예시, 방화벽 절차, 환경설정과 LAN 운영 문서를 추가한다.
   - 실제 PostgreSQL 통합 테스트, Inspector와 다른 장치의 Codex 연결을 검증한다.
   - 구현 결과는 `docs/work-log/2026-09-17-MCP-LanHosting.md`에 기록한다. 실제 작업일이 달라지면 해당 날짜로 파일명을 정한다.
   - 독립 커밋으로 남긴다.

각 커밋은 하나의 목적만 포함하며 무관한 기존 변경을 포함하지 않는다. 코드 포맷은 루트 설정을 따르고 `.prettierignore`의 문서·생성물 제외 규칙을 유지한다. 구현 완료 시 `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`를 수행한다.

## 검증 기준

- 토큰 발급·목록·폐기에는 기존 웹 세션이 필요하고 타인의 토큰을 조회·폐기할 수 없다.
- 원문은 발급 응답 외 DB, 로그, 목록 API와 브라우저 영구 저장소에 남지 않는다.
- 유효 토큰은 MCP 초기화·도구 조회에 성공하고 누락·변조·만료·폐기 토큰은 다음 요청에서 401로 거부된다.
- 웹 세션 토큰과 MCP 토큰은 서로의 인증 경로에서 대체 사용되지 않는다.
- 두 사용자의 토큰으로 변경하면 각각의 사용자 ID가 기록되고 도구 입력으로 작업자를 위조할 수 없다.
- 기존 REST와 MCP가 동일한 검증·권한·보관·충돌 규칙을 적용한다.
- 문서 변경은 기존 동기화 operation으로 수행하며 동시 변경을 덮어쓰거나 재시도로 중복 적용하지 않는다.
- 도구의 예외가 정제된 오류와 request ID로 반환되고 프로세스가 정상 요청을 계속 처리한다.
- 허용되지 않은 사내 대역 밖의 연결은 프록시·방화벽에서 차단되고 3001 직접 접속은 불가능하다.
- HTTPS 인증서 신뢰, 프록시 스트리밍, Host/Origin 검사와 실제 클라이언트 헤더 전달을 검증한다.
- 사내 다른 장치에서 주소·개인 토큰 설정, 조회·쓰기, 토큰 폐기 후 거부, 새 토큰으로 재연결을 검증한다.

## 후속 범위

- OAuth와 브라우저 연결 승인, 자동 토큰 갱신
- 세분화된 토큰 scope, 프로젝트별 권한과 역할 기반 권한
- 별도 MCP 프로세스 분리와 장애 격리
- 외부 로그 수집, 대시보드, 경보와 자동 보존 정책
- 인터넷 공개와 사내망 밖 원격 접속

사용자별 인증과 작업자 기록, HTTPS는 이번 범위에 포함한다. 외부 공개나 OAuth만 지원하는 클라이언트로의 확장은 별도 설계와 검증 후 진행한다.

## 참고

- [Codex MCP 설정](https://developers.openai.com/codex/mcp): Streamable HTTP와 `bearer_token_env_var` 설정
- 현재 저장소의 `apps/server/src/session.ts`: 웹 세션 인증과 작업자 구조
- 현재 저장소의 `apps/server/src/sync.service.ts`: 문서 동기화 서비스 재사용 대상
