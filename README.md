<p align = "center">
<img width="1560" height="285" alt="Image" src="https://github.com/user-attachments/assets/fd3b48ca-e0c7-40cb-97e0-58823d1009bf" />
</p>

# EZERD

도메인 관계도에서 시작해 테이블과 컬럼을 설계하는 팀 협업 ERD 도구이다.

기획자는 도메인과 비즈니스 흐름을 정리하고, 개발자는 그 맥락에서 DB 구조를 구체화한다. 도메인·테이블 캔버스와 핀 대화로 설계와 논의를 연결한다.

## 주요 기능

- **워크스페이스·프로젝트**: 공간 전환, 멤버 초대, owner/editor/viewer 권한, 프로젝트 검색·보관·복원.
- **도메인·테이블 설계**: 도메인 설명과 관계, 컬럼·타입·기본값·PK·UNIQUE·FK·ENUM 편집.
- **캔버스**: 직접 편집, 여러 객체 선택·이동, 관계선 조절, 사용자별 도메인 결합 뷰.
- **협업**: 자동 저장·WebSocket 동기화, 핀·답글·멘션·알림, 변경 이력·실행 취소·복원.
- **내보내기**: 공유 설계 JSON 내보내기·가져오기와 캔버스 PNG 저장. 개인 화면·계정·대화·히스토리는 JSON 전송에서 제외한다.
- **MCP**: AI 클라이언트에서 설계 조회·편집·진단과 공간·프로젝트 관리. 웹과 같은 권한 정책을 적용한다.

DB 종류 선택(PostgreSQL/MySQL/SQLite)은 메타데이터이며 타입·SQL 방언을 변환하지 않는다. PostgreSQL DDL 생성 모델은 있지만 현재 UI에서는 DDL 내보내기를 제공하지 않는다.

## 빠른 시작

Node.js **24.18.1 이상 25 미만**, pnpm **11.24.0**, 실행 중인 Docker Desktop이 필요하다. 저장소 루트에서 실행한다.

```powershell
pnpm install --frozen-lockfile
pnpm setup
pnpm db:up
pnpm db:migrate
pnpm db:check
pnpm dev
```

- `pnpm setup`은 `.env.example`을 `.env`로 복사하며 기존 파일을 덮어쓰지 않는다.
- 웹: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:3001/api/health> · DB 준비 확인: <http://127.0.0.1:3001/api/health/ready>
- DB: `127.0.0.1:55432`, 이름 `ezerd`. 데이터는 `.data/postgres`에 보존한다.
- 이후에는 `pnpm db:up`, `pnpm dev`로 실행한다. 새 마이그레이션이 있으면 `pnpm db:migrate`도 실행한다.

사용자명과 네 자리 PIN으로 접속한 뒤 워크스페이스를 만들거나 초대를 수락한다. 프로젝트를 생성하고 도메인 → 테이블 설계 → 핀 리뷰 순서로 사용할 수 있다.

개발 서버는 `Ctrl+C`, DB는 `pnpm db:stop`으로 종료한다. 기본 개발 환경은 로컬 접속용이며, 사내 LAN 호스팅과 MCP 토큰 연결은 [호스팅 안내](./docs/work-log/LAN_HOSTING.md)를 따른다. MCP는 기본적으로 비활성화되어 있다.

## 개발 명령

| 명령 | 용도 |
| --- | --- |
| `pnpm check` | 포맷·타입 검사, 단위 테스트, 전체 빌드 |
| `pnpm test` / `pnpm test:integration` | 단위 테스트 / PostgreSQL 기반 통합 테스트 |
| `pnpm build` | 공유 패키지·서버·웹 빌드 |
| `pnpm format` / `pnpm format:check` | 코드 포맷 적용 / 검사 |
| `pnpm db:generate` / `pnpm db:migrate` | 마이그레이션 생성 / 적용 |
| `pnpm host:start` | 빌드·마이그레이션 후 LAN 서비스 실행 |

통합 테스트는 설정된 DB를 사용한다. 전체 명령은 [package.json](./package.json)에서 확인할 수 있다.

## 기술과 구조

React · TypeScript · Vite · NestJS · PostgreSQL · Drizzle ORM · Zod · Vitest를 사용한다.

```text
apps/web/           캔버스·갤러리·워크스페이스 UI
apps/server/        API·인증·권한·동기화·리뷰·MCP
packages/model/     설계 모델·관계 검증·배치·변경 병합
packages/contracts/ API 계약과 타입
docs/               제품 계획·작업 기록·기타 문서
```

설계는 JSONB 문서로 저장한다. 캔버스에서 만든 테이블이 앱 DB에 실제 테이블로 생성되지는 않는다.

## 상세 문서

- [문서 분류와 안내](./docs/README.md) — 제품 계획 `planning`, 구현·검증 `work-log`, 보조 작업 `etc`
- [기능 사용 안내](./docs/work-log/USER_GUIDE.md) · [워크스페이스·초대·계정 전환](./docs/work-log/2026-09-30-Workspace-WebUI.md)
- [역할별 권한](./docs/work-log/2026-09-30-Workspace-Authorization.md) · [캔버스 선택·이동](./docs/work-log/2026-09-21-Canvas-SelectionAndOwnership.md) · [V/H 단축키](./docs/work-log/2026-09-30-Canvas-ToolShortcuts.md)
- [LAN 호스팅·MCP 연결](./docs/work-log/LAN_HOSTING.md) · [MCP 편집·개인 화면](./docs/work-log/2026-09-28-MCP-FeatureParity.md)
- [개발 환경 버전](./docs/work-log/DEVELOPMENT_VERSIONS.md) · [전체 의존성](./docs/work-log/DEPENDENCY_VERSIONS.md) · [환경 문제 확인](./docs/work-log/SETUP_VERIFICATION.md)
- [데이터 모델](./docs/planning/DATA_MODEL.md) · [디자인 시스템](./docs/planning/DESIGN_SYSTEM.md) · [DDL 모델 지원 범위](./docs/work-log/POSTGRES_EXPORT.md)
