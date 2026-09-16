# MCP 사내 LAN 호스팅 구현 계획

작성일: 2026-09-17
상태: 구현 전 계획

## 목표

EZERD의 기존 React·NestJS·PostgreSQL LAN 호스팅에 별도 Streamable HTTP MCP 서버를 추가한다. 사내 Codex 클라이언트가 프로젝트 조회뿐 아니라 생성, 수정, 리뷰와 문서 변경 작업까지 수행할 수 있게 하며, 초기 운영 경계는 MCP 애플리케이션 인증이 아니라 사내 서브넷 접근 제한으로 둔다.

```text
사내 Codex 클라이언트
        │ Streamable HTTP
        ▼
EZERD MCP 0.0.0.0:3002/mcp
        │ HTTP, loopback only
        ▼
EZERD NestJS 127.0.0.1:3001/api
        │
        ▼
PostgreSQL 127.0.0.1:55432
```

기존 웹 LAN 서비스는 계속 `0.0.0.0:3001`에서 React 정적 파일과 NestJS API를 함께 제공한다. MCP는 `apps/mcp`의 독립 프로세스로 실행하여 장애와 배포 수명주기를 분리한다.

## 확정 정책

- MCP는 `0.0.0.0:3002`의 `/mcp`에서 Streamable HTTP로 제공한다.
- `MCP_ALLOWED_CIDRS`에 지정한 사내 IPv4 서브넷과 loopback 요청만 허용한다. 빈 값이나 유효하지 않은 CIDR은 서버 시작 실패로 처리하며 전체 허용 기본값을 두지 않는다.
- 허용 판단에는 직접 연결의 소켓 주소만 사용한다. 초기 버전은 `X-Forwarded-For`를 신뢰하지 않으며 프록시 도입 시 별도 설계를 추가한다.
- 호스트 OS 방화벽도 TCP 3002 인바운드를 같은 사내 서브넷으로 제한한다. 애플리케이션 CIDR 검사와 방화벽 규칙을 이중 적용한다.
- MCP 클라이언트용 OAuth, Bearer token과 사용자별 인증은 이번 범위에 포함하지 않는다.
- 읽기·쓰기·삭제 도구를 기능상 비활성화하지 않는다. 모든 등록 도구를 클라이언트에 노출한다.
- 각 도구의 `readOnlyHint`, `destructiveHint`, `openWorldHint`는 실제 동작에 맞게 설정하되 도구 차단 정책으로 사용하지 않는다.
- 환경변수, PIN, 세션 토큰, DB 연결 문자열, 전체 요청 헤더와 내부 오류 스택은 MCP 응답에 포함하지 않는다.
- 로그는 로컬 파일로 생성하되 외부 수집, 대시보드, 알림 시스템은 이번 범위에서 구축하지 않는다.
- PostgreSQL 포트는 계속 loopback에만 바인딩하고 MCP가 DB에 직접 연결하지 않는다.

## 애플리케이션 구조

```text
apps/mcp/
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts                 # 설정 검증, HTTP 시작과 종료
    ├── mcp-server.ts           # 서버 정보, instructions, 도구 등록
    ├── transport.ts            # Streamable HTTP 세션 수명주기
    ├── config.ts               # 포트, CIDR, API 주소, 내부 사용자 설정
    ├── network/
    │   └── subnet-guard.ts     # remoteAddress CIDR 검사
    ├── api/
    │   ├── ezerd-api.client.ts # 기존 NestJS API 호출과 응답 검증
    │   └── session-provider.ts # 내부 사용자 세션 발급·갱신
    ├── logging/
    │   ├── logger.ts           # JSONL 파일 기록
    │   └── redaction.ts        # 민감 키 및 오류 정제
    └── tools/
        ├── projects.ts
        ├── document.ts
        ├── reviews.ts
        └── diagnostics.ts
```

MCP handler에는 비즈니스 규칙을 복제하지 않는다. 입력 형식과 MCP 결과를 검증하고 기존 NestJS API를 호출하는 어댑터로 제한한다. 공유 가능한 스키마는 `@ezerd/contracts`, 순수 문서 진단과 변경 계산은 `@ezerd/model`을 사용한다.

## 기존 세션 API 연결

기존 NestJS 쓰기 API는 유효한 사용자 세션을 요구하므로 이를 우회하거나 인증 없는 내부 쓰기 API를 추가하지 않는다. 대신 MCP 서버가 전용 내부 사용자로 기존 `POST /api/sessions`에 로그인한다.

- `EZERD_MCP_ACTOR_USERNAME`과 `EZERD_MCP_ACTOR_PIN`은 호스팅 PC의 환경변수에서만 읽는다.
- 전용 사용자는 기존 사용자 생성 절차로 한 번 준비한다.
- MCP 서버는 세션 토큰과 만료 시간을 메모리에만 보관한다.
- 만료 전 갱신하고, API가 401을 반환하면 세션을 한 번 재발급한 뒤 요청을 한 번만 재시도한다.
- PIN과 세션 토큰은 MCP 응답, tool 결과, 오류 상세와 로그에 기록하지 않는다.
- 초기 단계의 모든 MCP 쓰기는 이 전용 사용자로 기록된다. 사용자별 행위 귀속은 후속 MCP 인증 설계에서 다룬다.

이는 새 MCP 클라이언트 인증을 추가하는 작업이 아니라 현재 서버의 쓰기 불변조건을 유지하기 위한 내부 호출자 식별이다.

## 도구 설계

첫 구현에서는 저수준 REST endpoint를 그대로 노출하지 않고 사용자가 인지할 수 있는 작업 단위로 제공한다.

### 프로젝트

- `list_projects`: 상태와 검색어로 프로젝트 목록을 조회한다.
- `get_project`: 프로젝트 메타데이터와 현재 설계 문서를 조회한다.
- `create_project`: 프로젝트를 생성한다.
- `update_project`: 이름 또는 보관 상태를 현재 `expectedVersion` 기준으로 변경한다.
- `delete_project`: 보관된 프로젝트의 최신 버전을 영구 삭제한다.

### 리뷰

- `list_review_threads`: 프로젝트의 핀과 답글을 조회한다.
- `create_review_thread`: 뷰 또는 객체 위치에 리뷰 핀과 첫 메시지를 생성한다.
- `reply_review_thread`: 기존 핀에 답글을 추가한다.
- `update_review_thread`: 상태나 위치 등 현재 계약이 허용하는 속성을 수정한다.
- `delete_review_thread`: 최신 수정 시각을 기준으로 핀을 삭제한다.

### 문서와 진단

- `diagnose_project`: 현재 프로젝트 문서를 `@ezerd/model`로 진단하고 구조화된 문제 목록을 반환한다.
- `apply_project_changes`: 고수준 변경 요청으로 목표 문서를 구성한 뒤 기존 동기화 API를 통해 원자적으로 반영한다.
- `get_project_history`: 기존 동기화 이력을 조회한다.
- `undo_project_operation`: 기존 서버 규칙에 따라 승인 작업을 실행 취소한다.
- `restore_project_deletion`: 삭제 작업 스냅샷을 새 ID로 복원한다.

`apply_project_changes`는 전체 문서 PUT을 부활시키지 않는다. MCP 서버가 현재 문서와 동기화 기준을 조회하고, `@ezerd/model`의 의미 변경 계산을 사용하여 기존 `POST /api/projects/:id/operations` 계약을 호출한다. 초기 변경 명령은 도메인, 테이블, 컬럼, 키, 관계, 노트의 추가·수정·삭제를 명시적인 discriminated union으로 정의하며 자유 형식 JSON Patch는 사용하지 않는다.

모든 쓰기·삭제 도구는 `expectedVersion`, `expectedUpdatedAt`, operation ID 또는 서버 동기화 기준처럼 기존 API의 동시성 보호 값을 유지한다. 충돌 시 현재 값을 덮어쓰지 않고 재조회가 필요한 구조화 오류를 반환한다.

## 응답과 오류 정책

- Tool 입력은 Zod로 검증하고 알 수 없는 필드는 거부한다.
- Tool 출력도 공개 계약 스키마로 검증한 뒤 `structuredContent`와 짧은 `content`를 반환한다.
- 응답에는 작업 완료에 필요한 ID, 버전, 상태, 변경 경로와 사용자 데이터만 포함한다.
- 환경변수 이름과 값, 내부 API 기본 URL, DB URL, PIN, Authorization 헤더, 세션 토큰, 원시 응답 헤더는 반환하지 않는다.
- 예상 가능한 400, 401, 404, 409, 410, 503은 안정적인 MCP 오류 코드와 사용자용 메시지로 변환한다.
- 예상하지 못한 오류는 request ID만 반환하고 상세 원인과 정제된 스택은 로컬 로그에 기록한다.
- 문서와 리뷰 본문처럼 업무 데이터인 값은 tool 결과에는 필요 범위로 포함할 수 있지만 로그에는 원문을 기록하지 않는다.

## 로그 정책

로그는 `.data/logs/mcp/YYYY-MM-DD.jsonl`에 일 단위 JSON Lines로 append한다. `.data`는 이미 Git 추적 대상에서 제외되어 있다.

각 이벤트는 필요한 경우 다음 필드를 가진다.

- `timestamp`, `level`, `event`
- `requestId`, `mcpSessionId`
- `remoteAddress`, `toolName`
- `durationMs`, `outcome`, `statusCode`, `errorCode`
- 결과 개수나 변경 경로 개수처럼 내용이 아닌 제한된 수치

다음 값은 기록하지 않는다.

- 환경변수와 설정 객체 전체
- PIN, 세션 토큰, Authorization 또는 Cookie
- tool arguments와 tool results 전체
- 설계 문서, 리뷰 본문, 사용자 입력 원문
- DB 연결 문자열과 원시 오류 객체

시작, 종료, CIDR 거부, MCP 초기화 실패, tool 시작·성공·실패, 내부 API 재시도와 세션 갱신을 이벤트로 남긴다. 초기 구현은 외부 전송과 알림 없이 파일 생성과 보존만 담당하며, 보존 기간 자동 삭제도 후속 운영 작업으로 남긴다.

## 설정 계약

루트 `.env.example`과 설정 검증에 다음 항목을 추가한다. 실제 값은 `.env`에만 둔다.

```dotenv
MCP_HOST=0.0.0.0
MCP_PORT=3002
MCP_ALLOWED_CIDRS=192.168.0.0/24
MCP_API_BASE_URL=http://127.0.0.1:3001/api
EZERD_MCP_ACTOR_USERNAME=ezerd-mcp
EZERD_MCP_ACTOR_PIN=0000
MCP_LOG_DIR=.data/logs/mcp
```

예제 PIN은 로컬 예시이며 실제 사내 값으로 교체한다. 설정 오류 메시지는 누락된 키 이름만 알려주고 값을 출력하지 않는다.

## 실행과 운영

루트에 다음 명령을 제공한다.

- `pnpm mcp:dev`: MCP 서버 감시 실행
- `pnpm mcp:build`: MCP 앱 빌드
- `pnpm mcp:start`: 빌드된 MCP 서버 실행
- `pnpm mcp:inspect`: 로컬 MCP Inspector 실행 안내 또는 래퍼
- `pnpm host:start`: 기존 웹/API와 MCP를 함께 빌드·마이그레이션·실행
- `pnpm host:serve`: 준비된 웹/API와 MCP를 함께 실행

LAN 호스팅 스크립트는 웹 URL과 MCP URL을 별도로 출력하고, 실제 네트워크 인터페이스 후보를 표시한다. 두 자식 프로세스 중 하나가 종료되면 다른 프로세스도 정리하고 전체 명령을 실패 처리한다. PostgreSQL 컨테이너는 기존처럼 별도로 실행한다.

사무실 Codex 클라이언트에는 다음 형태의 연결을 안내한다.

```toml
[mcp_servers.ezerd]
url = "http://192.168.0.20:3002/mcp"
default_tools_approval_mode = "writes"
tool_timeout_sec = 60
```

도구 자체를 비활성화하지 않지만, 클라이언트의 `writes` 승인 모드는 실제 쓰기 도구 호출 전에 사용자가 작업 내용을 확인할 수 있게 한다. 원하는 클라이언트에서는 별도 정책으로 `approve`를 선택할 수 있다.

## 구현 단위와 커밋

1. **MCP 기반 앱과 네트워크 경계**
   - `apps/mcp` 패키지, 설정 검증, Streamable HTTP transport, CIDR guard, health/startup 처리와 단위 테스트를 추가한다.
   - MCP SDK와 CIDR 파서 의존성을 정확한 버전으로 고정한다.
   - 독립 커밋으로 남긴다.
2. **API 클라이언트와 내부 사용자 세션**
   - 응답 스키마 검증, 세션 발급·갱신·단일 재시도, 오류 변환과 민감정보 정제를 구현한다.
   - API mock 기반 단위 테스트로 토큰 비노출과 재시도를 검증한다.
   - 독립 커밋으로 남긴다.
3. **프로젝트·리뷰 도구**
   - 프로젝트 및 리뷰의 읽기·쓰기·삭제 tool을 추가하고 실제 동작에 맞는 annotation과 입출력 스키마를 정의한다.
   - 기존 NestJS 통합 환경에 연결한 MCP tool 통합 테스트를 추가한다.
   - 독립 커밋으로 남긴다.
4. **문서 변경·진단·이력 도구**
   - 고수준 변경 명령, 동기화 기준 수립, 작업 제출, 충돌·undo·restore 흐름을 구현하고 모델 단위 테스트와 통합 테스트를 추가한다.
   - 독립 커밋으로 남긴다.
5. **로그와 LAN 실행 통합**
   - JSONL 로그, redaction 테스트, 루트 실행 명령, 호스팅 스크립트, `.env.example`, LAN 운영 문서를 갱신한다.
   - 호스트 방화벽에서 3002를 사내 CIDR에만 허용하는 운영 절차를 OS별 예시로 기록하되 스크립트가 방화벽을 자동 변경하지는 않는다.
   - 독립 커밋으로 남긴다.
6. **최종 검증과 작업 기록**
   - 포맷, 타입 검사, 단위 테스트, 빌드, 실제 PostgreSQL 통합 테스트, MCP Inspector, 허용·거부 IP 검증을 수행한다.
   - 결과를 `docs/work-log/2026-09-17-MCP-LanHosting.md`에 기록하고 독립 커밋으로 남긴다.

각 커밋은 요청과 무관한 기존 변경을 포함하지 않는다. 코드와 문서는 루트 Prettier 설정을 따르고 최종적으로 `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`를 통과해야 한다.

## 검증 기준

- 허용 CIDR의 클라이언트는 `/mcp` 초기화와 tool 목록 조회에 성공한다.
- 허용되지 않은 주소는 MCP 세션 생성 전 403으로 거부되고 CIDR 거부 로그가 남는다.
- 프로젝트·리뷰의 읽기, 생성, 수정, 보관과 삭제 도구가 기존 REST API와 동일한 검증·충돌 규칙을 따른다.
- 문서 변경 도구가 전체 PUT 없이 기존 동기화 operation을 만들며 동시 변경을 덮어쓰지 않는다.
- 모든 tool이 등록되고 기능상 비활성화되지 않는다.
- 환경변수, PIN, 세션 토큰, DB URL과 Authorization 값이 MCP 응답과 로그에 나타나지 않는다.
- 예상하지 못한 오류 응답에는 request ID만 포함되고 동일 ID의 정제 로그를 찾을 수 있다.
- 로그 파일이 날짜별로 생성되며 tool 성공·실패와 처리 시간이 기록된다.
- MCP 프로세스 중단이 NestJS API 프로세스를 직접 손상시키지 않고, 통합 실행 명령은 장애를 감지해 명확히 종료한다.
- 사내 다른 장치의 Codex에서 `http://호스팅PC:3002/mcp`로 연결해 조회와 쓰기 tool을 각각 한 번 이상 실제 검증한다.

## 후속 범위

이번 구현에 포함하지 않는 항목은 다음과 같다.

- MCP 사용자별 OAuth 또는 Bearer token 인증
- 사용자별 MCP 작업 귀속과 역할 기반 권한
- TLS 종단과 리버스 프록시
- 외부 로그 수집, 대시보드, 경보와 자동 보존 정책
- 인터넷 공개와 사내망 밖 원격 접속

MCP가 사내 LAN 밖으로 노출되거나 사용자별 작업 귀속이 필요해지는 시점에는 인증과 TLS를 구현하기 전까지 공개 범위를 확대하지 않는다.
