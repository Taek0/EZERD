<p align = "center">
<img width="1560" height="285" alt="Image" src="https://github.com/user-attachments/assets/fd3b48ca-e0c7-40cb-97e0-58823d1009bf" />
</p>
# EZERD

도메인 관계도에서 시작해 논리·물리 ERD로 이어지는 팀 협업 설계 도구.

현재 username 입장, 프로젝트 갤러리, 도메인·테이블 ERD, 댓글·멘션·알림, 서버 저장과 PostgreSQL DDL 내보내기를 구현했습니다. LAN 실행 설정은 준비했으며 실제 Wi-Fi 공개 실행은 별도 확인 단계입니다. 상세 동작과 검증은 [구현 진행 기록](./docs/work-log/IMPLEMENTATION_PROGRESS.md)에 있습니다. 첫 출시는 username 입장, 프로젝트 갤러리, 점 격자 캔버스의 도메인·테이블 설계, 서버 저장, 기본 PostgreSQL 생성 DDL 내보내기와 댓글·멘션을 포함하기로 확정했습니다. 실시간 ERD 공동 편집·복원과 고급 기능은 후속 단계에서 다룹니다. 확장 인증은 추후 결정합니다.

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
cd D:\ChatGPT\ERD
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

현재 개발 설정의 웹·API·DB는 로컬 주소에만 바인딩합니다. 목표 배포는 사용자의 PC에서 호스팅하고 사내 Wi-Fi에서 웹에 접속하는 방식이며, LAN 접속 설정과 실행 스크립트는 [호스팅 문서](./docs/work-log/LAN_HOSTING.md)에 준비했습니다. 실제 공개 실행 및 다른 장치 접속 확인은 별도 단계입니다. username 기반 사용에 인증·역할별 권한을 요구하지 않습니다. `.env.example`의 DB 계정은 로컬 개발 전용입니다.

## 명령어

| 명령 | 동작 |
| --- | --- |
| `pnpm dev` | 공통 패키지·웹·서버를 변경 감지 모드로 실행 |
| `pnpm check` | 타입 검사, 공유 모델·계약·클라이언트 테스트, 전체 빌드 |
| `pnpm docs:ui-licenses` | 브라우저 런타임 라이선스 고지와 배포용 사본 생성 |
| `pnpm docs:versions` | manifest·lockfile·설치 그래프에서 패키지 버전 문서 생성 |
| `pnpm typecheck` | 공유 패키지를 준비한 뒤 전체 타입 검사 |
| `pnpm test` | 모델·계약·클라이언트 테스트 (DB 통합 테스트 제외) |
| `pnpm test:integration` | 현재 코드를 빌드한 후 실제 PostgreSQL HTTP 통합 테스트 |
| `pnpm build` | 의존 순서대로 공유 패키지·서버·웹 빌드 |
| `pnpm test:ddl` | 생성 SQL을 실제 PostgreSQL에서 실행·롤백 |
| `pnpm host:start` | 빌드·마이그레이션 후 웹/API LAN 서비스 실행 |
| `pnpm host:serve` | 준비된 빌드의 LAN 서비스 실행 |
| `pnpm db:up` | PostgreSQL 컨테이너 실행 및 준비 상태 대기 |
| `pnpm db:stop` | 이 프로젝트의 DB 컨테이너만 정지, 데이터 보존 |
| `pnpm db:generate` | Drizzle 스키마 변경에 대한 SQL 마이그레이션 생성 |
| `pnpm db:migrate` | 생성된 마이그레이션 적용 |
| `pnpm db:check` | Drizzle 저장·조회와 롤백 검증, 테스트 데이터 미보존 |

개발 서버는 실행한 터미널에서 `Ctrl+C`로 종료합니다. `pnpm db:stop`은 DB를 별도로 정지합니다. 기존 프로젝트 데이터 폴더를 지우는 초기화 명령은 제공하지 않습니다.

마이그레이션 이름을 지정할 때:

```powershell
pnpm --filter @ezerd/server exec drizzle-kit generate --config drizzle.config.ts --name=add_project_description
```

## 코드 구조

```text
apps/
  web/                      React 화면, Vite 개발 프록시
  server/
    src/db/schema.ts        EZERD 자체 DB 테이블 정의
    src/db/database.service.ts
    src/health.controller.ts
    drizzle/                SQL 마이그레이션과 메타데이터
    scripts/db-check.ts     실제 DB 연결 검증
packages/
  model/                    논리·물리 적용 범위와 공통 모델 규칙
  contracts/                API 스키마와 타입
scripts/setup.mjs            로컬 환경 파일 준비
```

공유 패키지는 TypeScript 소스에서 `dist`로 빌드한 뒤 사용합니다. `pnpm dev`가 선행 빌드와 변경 감지를 처리합니다. 서버는 TypeScript 컴파일러로 데코레이터를 처리하고 Node.js로 실행합니다.

프런트엔드 `/api` 요청은 Vite가 API 서버에 프록시합니다. 브라우저에 DB 접속 정보를 전달하지 않습니다. 개발 서버 포트가 사용 중이면 자동으로 다른 포트로 이동하지 않고 오류를 표시합니다.

현재 마이그레이션은 사용자, 프로젝트 메타데이터, 버전과 JSONB 설계 문서를 저장합니다. 사용자가 캔버스에서 설계할 테이블을 앱 DB에 실제 테이블로 생성하는 기능은 아닙니다.

## 연결 문제 확인

- API 요청에 실패하면 `/api/health` 응답, `pnpm dev`의 서버 로그, `.env`의 `PORT`를 확인합니다.
- DB 연결에 실패하면 `pnpm db:up`과 `pnpm db:migrate`를 실행한 뒤 다시 시도합니다.
- API 실행 확인은 DB가 없어도 200을 반환합니다. 준비 확인은 DB나 마이그레이션이 준비되지 않았으면 503을 반환합니다.
- `DATABASE_URL`이나 서버 설정을 수정한 경우 개발 서버를 재시작합니다. DB 계정 정보를 바꾸면 Compose 설정과 URL을 함께 맞춰야 합니다. 이미 초기화된 DB의 비밀번호는 환경 변수 변경만으로 바뀌지 않습니다.
- Docker 자체가 시작되지 않으면 앱과 별도의 문제입니다. 이번 Windows 소켓 오류의 확인·복구 기록은 [개발 환경 검증 기록](./docs/work-log/SETUP_VERIFICATION.md)을 참고합니다.

## 개발 문서

[문서 분류와 전체 목록](./docs/README.md)에서 계획·설계와 진행 작업을 나눠 확인할 수 있습니다.

UI 폰트는 Apple SD Gothic Neo이며, 제공받은 폰트의 프로젝트 내부 서브셋을 사용합니다. 굵기별 용도와 자산 위치는 [디자인 문서](./docs/planning/DESIGN_SYSTEM.md)에 있습니다.

- [첫 출시 기능 사용법](./docs/work-log/USER_GUIDE.md)
- [PostgreSQL DDL 지원 범위](./docs/work-log/POSTGRES_EXPORT.md)
- [사내 Wi-Fi 호스팅](./docs/work-log/LAN_HOSTING.md)
- [구현 진행 기록과 다음 단계](./docs/work-log/IMPLEMENTATION_PROGRESS.md)
- [편집 워크플로우 개선 결정 사항 · 다음 구현 대상](./docs/planning/EDITOR_WORKFLOW_DECISIONS.md)
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
