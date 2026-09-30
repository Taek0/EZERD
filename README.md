<p align = "center">
<img width="1560" height="285" alt="Image" src="https://github.com/user-attachments/assets/fd3b48ca-e0c7-40cb-97e0-58823d1009bf" />
</p>

# EZERD

도메인 관계도에서 시작해 테이블과 컬럼을 설계하는 팀 협업 ERD 도구.

파란색 계열의 뉴모피즘·스위스 디자인을 바탕으로, 도메인 흐름과 테이블 구조를 하나의 워크스페이스에서 편집합니다. 현재 편집 UI는 물리 테이블·컬럼명을 중심으로 구성되어 있습니다.

테이블부터 그리기보다 서비스의 도메인과 비즈니스 흐름을 먼저 정리하고, 그 맥락 안에서 DB 구조를 구체화하기 위한 도구입니다. 기획자는 도메인 설명·관계·메모로 의도를 기록하고, 개발자는 도메인별 테이블·컬럼·키를 설계하며, 같은 캔버스의 핀 대화로 의견을 나눌 수 있습니다.

사용자는 여러 워크스페이스에 참여할 수 있고 각 워크스페이스는 멤버·역할·프로젝트를 독립적으로 관리합니다. 아래 설명은 2026-09-30 저장소 구현 기준입니다.

## 주요 기능

- **워크스페이스**: 생성·전환, 멤버 초대·수락·거절, 역할 관리, 보관·복원. 상단 로고 옆에서 현재 공간을 선택합니다.
- **프로젝트 갤러리**: 카드에서 이름·DB 종류 편집, 실제 테이블·관계 수와 설계 미리보기, 검색·정렬·보관·복원·삭제. 기본은 생성순이며 최근 수정순·이름순도 선택할 수 있습니다.
- **도메인 캔버스**: 도메인 색상과 설명, 관계 목록과 즉시 편집, 우클릭 자동 배치.
- **테이블 캔버스**: 카드에서 컬럼명·타입·NULL 직접 편집, Tab으로 타입 검색, 타입에 맞는 기본값 설정, PK/복합 UNIQUE, 프로젝트 ENUM, 컬럼 순서 변경, NULL/comment 숨김, 이미지 내보내기.
- **테이블 도메인 변경**: 사이드바의 기본 정보에서 소속 도메인 변경. 일반 도메인 화면은 소속 테이블만 표시하며 컬럼·키·FK는 보존합니다.
- **테이블 관계**: PK → FK 연결과 FK 컬럼 자동 생성, 컬럼명·대응관계 설정, ON UPDATE/ON DELETE, 직각 선분과 까마귀발 접점 조절.
- **도메인 뷰**: 여러 도메인의 테이블을 기존 상대 배치대로 함께 보기. 카드 위치는 고정하며 관계선은 조절할 수 있습니다. 개인 결합 뷰·메모·참조 노드·뷰포트·관계 경로는 사용자·프로젝트별로 서버에 저장하고 웹과 MCP에서 함께 사용합니다.
- **핀 대화**: 캔버스 우클릭으로 위치에 핀 작성, 답글·멘션·알림, 해결 처리와 삭제.
- **자동 저장·협업**: 객체 속성 단위 변경과 WebSocket 기반 동기화, 변경자·일시 및 동작 필터를 제공하는 히스토리, 실행 취소와 복원.
- **프로젝트 내보내기·가져오기**: 갤러리에서 설계를 JSON 파일로 내보내거나 선택한 워크스페이스의 새 프로젝트로 가져오기. 이름·DB 종류·공유 설계와 배치는 포함하고 워크스페이스 멤버십·사용자·인증·개인 화면·핀 대화·히스토리는 제외합니다. 내보내기는 서버에 동기화된 최신 설계를 사용합니다.
- **MCP 연동**: AI 클라이언트에서 공간·프로젝트 관리, 도메인·테이블·컬럼·관계·ENUM 편집, 공유 배치·개인 화면 변경, 핀 대화·알림·히스토리 조회 및 설계·배치 진단.

프로젝트의 PostgreSQL/MySQL/SQLite 선택은 분류용 메타데이터이며 물리 타입이나 DDL 방언을 변환하지 않습니다. PostgreSQL DDL 생성 모델과 검증 스크립트는 저장소에 남아 있으나, 현재 화면에서는 DDL 내보내기를 제공하지 않습니다. 최근 변경과 검증 결과는 아래 개발 문서의 작업 기록을 참고하세요.

## 기본 사용 흐름과 권한

1. 사용자명과 네 자리 PIN으로 접속합니다. 소속 공간이 없으면 `워크스페이스 만들기`로 시작하거나 받은 초대를 수락합니다.
2. 상단에서 워크스페이스를 선택하고 갤러리의 `⋯` 메뉴에서 프로젝트를 만들거나 JSON 파일을 가져옵니다. 새 프로젝트 이름을 비워 두면 `새 프로젝트`, `새 프로젝트 1` 등의 이름을 자동으로 지정합니다.
3. 도메인 캔버스에서 서비스 영역·관계·설명을 정리한 뒤 도메인 내부의 테이블 캔버스에서 컬럼·키·FK를 설계합니다.
4. 핀과 답글로 논의하고, 자동 저장·동기화와 히스토리로 변경을 확인합니다. 여러 도메인을 함께 검토할 때는 개인 도메인 뷰를 사용합니다.

권한은 프로젝트별이 아니라 소속 워크스페이스의 역할을 기준으로 적용합니다.

| 역할 | 활성 워크스페이스에서 가능한 작업 |
| --- | --- |
| viewer | 조회·내보내기, 핀·댓글, 자신의 개인 화면 편집 |
| editor | viewer 권한 + 프로젝트 생성·가져오기, 공유 설계 편집, 프로젝트 이름·DB 종류 변경 및 보관·복원 |
| owner | editor 권한 + 멤버·초대·공간 관리, 프로젝트 영구 삭제 |

보관된 워크스페이스는 조회·내보내기만 허용하며 개인 화면과 리뷰 쓰기도 제한합니다. 소유자는 보관 중에도 멤버·초대를 관리하고 공간을 복원할 수 있습니다. 마지막 소유자의 강등·제거는 막으며, 공간 삭제는 빈 워크스페이스에서만 가능합니다. 사용자 메뉴의 로그아웃으로 계정을 전환할 수 있습니다.

## 캔버스 조작

배율 표시 왼쪽에서 커서·손 도구를 선택합니다. 도메인과 테이블 캔버스에 공통으로 적용됩니다.

| 조작 | 동작 |
| --- | --- |
| V / H | 커서 / 손 도구 전환 (텍스트 입력·IME 조합·메뉴·드래그 중에는 적용하지 않음) |
| 커서 도구로 빈 공간 드래그 | 영역 안의 여러 카드·메모 선택 |
| 선택한 객체 드래그 | 선택한 객체를 함께 이동 |
| 손 도구로 드래그 | 카드 편집 없이 화면 이동 |
| 휠 버튼을 누른 채 드래그 | 커서 도구에서도 화면 이동 |
| 트랙패드 두 손가락 스와이프 / 핀치 | 화면 이동 / 확대·축소 |
| 캔버스 우클릭 | 생성·자동 배치 등의 메뉴 표시, 손 도구에서도 사용 가능 |
| Delete / Escape | 선택 객체 삭제 확인 / 영역 선택 취소 |

읽기 전용 프로젝트와 도메인 뷰의 고정 배치에서는 객체 이동이 제한됩니다. 도메인 뷰의 관계선은 계속 조절할 수 있습니다.

## 사용자와 인증

사용자명과 숫자 네 자리 PIN으로 접속합니다. 사용자명은 대소문자 입력을 허용하지만 앞뒤 공백 제거·소문자 정규화 후 저장하며, PIN과 무관하게 이름 자체가 고유합니다. 같은 이름·PIN으로 다시 접속하면 기존 계정을 사용합니다.

API 쓰기 요청은 세션 토큰으로 인증하며, 핀 작성자도 서버가 세션에서 결정합니다. PIN은 현재 서버에서 SHA-256 해시로 저장하고 브라우저 저장소에는 보관하지 않습니다. 로그인·식별 요청에는 빈도 제한을 적용합니다. MCP는 90일 사용자별 전용 토큰을 별도로 사용하며 원문은 발급할 때 한 번만 보여 줍니다. 초기 LAN 운영은 호스팅 PC의 사설 IPv4에서 HTTP로 직접 제공하며, 앱이 승인된 사내 CIDR만 허용합니다.

프로젝트·설계·리뷰 조회와 변경은 서버에서 현재 워크스페이스 멤버십을 확인합니다. 역할 변경이나 멤버 제거는 WebSocket 접근에도 반영되고, 웹은 편집 전송을 멈춘 뒤 권한을 다시 확인합니다. MCP에도 동일한 역할·보관 정책을 적용합니다.

## EZERD MCP 연결

EZERD 서버는 Streamable HTTP `/mcp` 엔드포인트를 제공합니다. 기본 개발 환경에서는 `MCP_ENABLED=false`로 꺼져 있습니다.

1. [LAN 호스팅 안내](./docs/work-log/LAN_HOSTING.md)에 따라 승인된 CIDR과 `MCP_ENABLED=true`, `MCP_PUBLIC_URL`을 설정하고 서버를 실행합니다.
2. 웹의 사용자 메뉴에서 MCP 연결 화면을 열어 개인 토큰을 발급합니다. PIN 대신 이 토큰을 클라이언트 인증에 사용합니다.
3. 클라이언트에 서버 URL과 토큰 환경변수를 등록합니다. Codex 설정 및 환경변수 예시는 호스팅 안내의 **웹과 MCP 연결** 절을 참고하세요.

연결 후 `whoami`와 `list_workspaces`로 사용자·공간을 확인하고 대상 공간의 프로젝트를 조회합니다. 프로젝트 생성·가져오기에는 `workspaceId`가 필요합니다. 토큰이 있어도 참여하지 않은 공간에는 접근할 수 없으며, 만료·폐기 또는 멤버십 변경 시 권한을 다시 검사합니다.

## 개발 환경

| 구성 | 버전 / 용도 |
| --- | --- |
| Node.js | 24.18.1, `.node-version` 참고 |
| pnpm | 11.24.0, `packageManager`로 고정 |
| TypeScript | 6.0.3, strict 및 ESM |
| 웹 | React 19.3.0, Vite 8.3.0 |
| 서버 | NestJS 12.0.1 |
| DB 접근 | Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, node-postgres |
| DB | PostgreSQL 18.6, Docker Compose |
| 검증 | Zod 4.6.5, Vitest 5.0.0 |

실제 설치 버전은 각 `package.json`과 `pnpm-lock.yaml`로 관리합니다. pnpm 11 설정과 허용된 의존성 빌드 스크립트는 `pnpm-workspace.yaml`에 있습니다. 패키지 저장 캐시는 프로젝트 안의 `.cache`를 사용합니다.

런타임·Docker·DB·타입 정의의 상세 버전은 [개발 환경 버전 기준](./docs/work-log/DEVELOPMENT_VERSIONS.md), 직접·간접 의존성 전체는 [패키지 버전 전체 목록](./docs/work-log/DEPENDENCY_VERSIONS.md)에 기록합니다.

## 처음 실행하기

Docker Desktop이 정상 실행 중이어야 DB 컨테이너를 시작할 수 있습니다. 아래 명령은 저장소 루트에서 실행합니다.

```powershell
# 저장소 디렉터리에서 실행
pnpm install --frozen-lockfile
pnpm setup
pnpm db:up
pnpm db:migrate
pnpm db:check
pnpm dev
```

- `pnpm setup`은 `.env.example`을 `.env`로 복사합니다. 기존 `.env`는 덮어쓰지 않습니다.
- 웹: <http://127.0.0.1:5173>
- API 실행 확인: <http://127.0.0.1:3001/api/health>
- DB 및 스키마 준비 확인: <http://127.0.0.1:3001/api/health/ready>
- 개발 DB: `127.0.0.1:55432`, DB명 `ezerd`. 로컬 접속 정보는 `.env`에 있습니다.
- DB 데이터는 `.data/postgres`에 보존하며 Git에서 제외합니다.
- 이후 실행에서는 Docker가 켜진 상태에서 `pnpm db:up`, `pnpm dev`를 사용합니다. 새 마이그레이션이 있으면 `pnpm db:migrate`도 실행합니다.

현재 개발 설정의 웹·API·DB는 로컬 주소에만 바인딩합니다. PC에서 호스팅해 사내 Wi-Fi로 접속하는 설정과 실행 스크립트는 [호스팅 문서](./docs/work-log/LAN_HOSTING.md)에 있습니다. 실제 외부 장치 연결은 네트워크·방화벽 설정에 따라 확인해야 합니다. `.env.example`의 DB 계정은 로컬 개발 전용입니다.

## 명령어

| 명령 | 동작 |
| --- | --- |
| `pnpm dev` | 공통 패키지·웹·서버를 변경 감지 모드로 실행 |
| `pnpm check` | Prettier 검사, 전체 타입 검사, 단위 테스트, 전체 빌드 |
| `pnpm format` / `pnpm format:check` | 루트 Prettier 설정으로 포맷 적용 / 검사 |
| `pnpm docs:ui-licenses` | 브라우저 런타임 라이선스 고지와 배포용 사본 생성 |
| `pnpm docs:versions` | manifest·lockfile·설치 그래프에서 패키지 버전 문서 생성 |
| `pnpm typecheck` | 공유 패키지를 준비한 뒤 전체 타입 검사 |
| `pnpm test` | 모델·계약·클라이언트 테스트 (DB 통합 테스트 제외) |
| `pnpm test:integration` | 현재 코드를 빌드한 후 설정된 PostgreSQL에서 HTTP·WebSocket 통합 테스트 |
| `pnpm build` | 의존 순서대로 공유 패키지·서버·웹 빌드 |
| `pnpm test:ddl` | 생성 SQL을 실제 PostgreSQL에서 실행·롤백 |
| `pnpm host:start` | 빌드·마이그레이션 후 웹/API LAN 서비스 실행 |
| `pnpm host:serve` | 준비된 빌드의 LAN 서비스 실행 |
| `pnpm db:up` | PostgreSQL 컨테이너 실행 및 준비 상태 대기 |
| `pnpm db:stop` | 이 프로젝트의 DB 컨테이너만 정지, 데이터 보존 |
| `pnpm db:generate` | Drizzle 스키마 변경에 대한 SQL 마이그레이션 생성 |
| `pnpm db:migrate` | 생성된 마이그레이션 적용 |
| `pnpm db:check` | Drizzle 저장·조회와 롤백 검증, 테스트 데이터 미보존 |

개발 서버는 실행한 터미널에서 `Ctrl+C`로 종료합니다. `pnpm db:stop`은 DB를 별도로 정지하며 데이터를 보존합니다.

기존 DB와 분리해 통합 테스트를 실행하려면 다음 명령을 사용합니다. 로컬 PostgreSQL에 임시 DB를 생성할 권한이 필요하며, 실행 후 임시 DB를 삭제합니다.

```powershell
pnpm build
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts
```

`apps/server/scripts/reset-users.ts`는 사용자·세션·핀 대화·사용자 히스토리를 삭제하는 운영용 스크립트입니다. 일반 설치·실행 과정에 포함하지 않으며, 명시적인 확인 플래그가 있어야 실행됩니다. 프로젝트 문서는 보존 여부를 검증합니다.

마이그레이션 이름을 지정할 때:

```powershell
pnpm --filter @ezerd/server exec drizzle-kit generate --config drizzle.config.ts --name=add_project_description
```

## 코드 구조

```text
apps/
  web/src/
    app/                    앱 조립과 자동 저장 연결
    features/               canvas, tables, relations, domains 등 기능별 화면·로직
    components/ui/          공통 UI 컴포넌트
    shared/                 API 클라이언트, 편집기 공통 요소, hooks
    styles/                 전역·편집기 스타일
  server/
    src/workspace/          공간·멤버·초대·권한, 프로젝트·설계·개인 상태 API
    src/sync/               동기화 API·WebSocket
    src/review/             핀·댓글·알림
    src/identity/           세션과 사용자 식별
    src/network/            LAN 접근 제어
    src/mcp/                MCP 연결과 도구
    src/shared/             공통 요청 빈도 제한
    src/db/schema.ts        EZERD 자체 DB 테이블 정의
    src/db/database.service.ts
    src/health.controller.ts
    drizzle/                SQL 마이그레이션과 메타데이터
    scripts/db-check.ts     실제 DB 연결 검증
packages/
  model/                    설계 모델, 관계 검증, 배치, 변경 병합과 복원
  contracts/                API 스키마와 타입
scripts/setup.mjs            로컬 환경 파일 준비
```

공유 패키지는 TypeScript 소스에서 `dist`로 빌드한 뒤 사용합니다. `pnpm dev`가 선행 빌드와 변경 감지를 처리합니다. 서버는 TypeScript 컴파일러로 데코레이터를 처리하고 Node.js로 실행합니다.

프런트엔드 `/api` 요청은 Vite가 API 서버에 프록시합니다. 브라우저에 DB 접속 정보를 전달하지 않습니다. 개발 서버 포트가 사용 중이면 자동으로 다른 포트로 이동하지 않고 오류를 표시합니다.

앱 DB에는 사용자·세션·MCP 토큰, 워크스페이스·멤버·초대·감사 기록, 프로젝트와 JSONB 공유 설계 문서, 사용자별 개인 화면, 핀 대화·알림, 동기화 이력을 저장합니다. 캔버스에서 만든 테이블이 앱 DB에 실제 테이블로 생성되지는 않습니다.

## 연결 문제 확인

- API 요청에 실패하면 `/api/health` 응답, `pnpm dev`의 서버 로그, `.env`의 `PORT`를 확인합니다.
- DB 연결에 실패하면 `pnpm db:up`과 `pnpm db:migrate`를 실행한 뒤 다시 시도합니다.
- 사용자명 정규화 마이그레이션은 기존에 대소문자만 다른 중복 계정이 있으면 실패할 수 있습니다. 계정 정리 방침을 결정한 뒤 적용해야 하며 자동으로 병합하지 않습니다.
- API 실행 확인은 DB가 없어도 200을 반환합니다. 준비 확인은 DB나 마이그레이션이 준비되지 않았으면 503을 반환합니다.
- `DATABASE_URL`이나 서버 설정을 수정한 경우 개발 서버를 재시작합니다. DB 계정 정보를 바꾸면 Compose 설정과 URL을 함께 맞춰야 합니다. 이미 초기화된 DB의 비밀번호는 환경 변수 변경만으로 바뀌지 않습니다.
- Docker 자체가 시작되지 않으면 앱과 별도의 문제입니다. 이번 Windows 소켓 오류의 확인·복구 기록은 [개발 환경 검증 기록](./docs/work-log/SETUP_VERIFICATION.md)을 참고합니다.

## 개발 문서

[문서 분류와 전체 목록](./docs/README.md)에서 계획·설계와 진행 작업을 나눠 확인할 수 있습니다.

UI 폰트는 Apple SD Gothic Neo이며, 제공받은 폰트의 프로젝트 내부 서브셋을 사용합니다. 굵기별 용도와 자산 위치는 [디자인 문서](./docs/planning/DESIGN_SYSTEM.md)에 있습니다.

- [워크스페이스 UI·초대·계정 전환](./docs/work-log/2026-09-30-Workspace-WebUI.md)
- [워크스페이스 역할·동기화 권한](./docs/work-log/2026-09-30-Workspace-Authorization.md)
- [상단 워크스페이스 전환](./docs/work-log/2026-09-30-Workspace-HeaderSwitcher.md)
- [프로젝트 갤러리 개편](./docs/work-log/2026-09-30-Gallery-ApprovedRedesign.md)
- [DB 종류·자동 이름·미리보기](./docs/work-log/2026-09-30-Gallery-ProjectMetadata.md)
- [갤러리 정렬·메뉴·공간 관리](./docs/work-log/2026-09-30-Gallery-ToolbarAndOrder.md)
- [MCP 편집·개인 화면 저장·배치 진단](./docs/work-log/2026-09-28-MCP-FeatureParity.md)
- [MCP 워크스페이스 권한](./docs/work-log/2026-09-30-MCP-WorkspaceAuthorization.md)
- [캔버스 도구 단축키](./docs/work-log/2026-09-30-Canvas-ToolShortcuts.md)
- [초기 피드백 구현·QA](./docs/work-log/2026-09-15-Workspace-FeedbackQA.md)
- [기능별 폴더 구조 정리](./docs/work-log/2026-09-21-Repository-FolderRefactoring.md)
- [테이블 도메인 변경](./docs/work-log/2026-09-21-Table-DomainMove.md)
- [캔버스 선택·이동 도구](./docs/work-log/2026-09-21-Canvas-SelectionAndOwnership.md)
- [손 도구 우클릭·휠 버튼 이동](./docs/work-log/2026-09-21-Canvas-PointerNavigation.md)
- [프로젝트 내보내기·가져오기](./docs/work-log/2026-09-17-Project-ExportImport.md)
- [사용자명 정규화와 고유성](./docs/work-log/2026-09-15-Auth-NormalizedUsernames.md)
- [기존 기능 사용 안내](./docs/work-log/USER_GUIDE.md)
- [PostgreSQL DDL 모델 지원 범위 · 현재 UI 제외](./docs/work-log/POSTGRES_EXPORT.md)
- [사내 Wi-Fi 호스팅](./docs/work-log/LAN_HOSTING.md)
- [구현 진행 기록과 다음 단계](./docs/work-log/IMPLEMENTATION_PROGRESS.md)
- [편집 워크플로우 설계 결정 기록](./docs/planning/EDITOR_WORKFLOW_DECISIONS.md)
- [요구사항](./docs/planning/REQUIREMENTS.md)
- [첫 출시 범위와 완료 기준](./docs/planning/RELEASE_SCOPE.md)
- [논리·물리 통합 데이터 모델](./docs/planning/DATA_MODEL.md)
- [기술 스택과 구현 상태](./docs/planning/TECH_STACK.md)
- [개발 환경 상세 버전](./docs/work-log/DEVELOPMENT_VERSIONS.md)
- [패키지 전체 버전](./docs/work-log/DEPENDENCY_VERSIONS.md)
- [공통 UI 컴포넌트와 사용법](./docs/work-log/SHARED_UI.md)
- [디자인 방향과 토큰](./docs/planning/DESIGN_SYSTEM.md)
- [Drizzle 첫 단계](./docs/work-log/DRIZZLE_START.md)
- [환경 검증 기록](./docs/work-log/SETUP_VERIFICATION.md)
