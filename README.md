# EZERD

도메인 관계도에서 시작해 논리·물리 ERD로 이어지는 팀 협업 설계 도구.

현재는 개발 환경과 연결 확인 화면을 구성한 단계입니다. 프로젝트 갤러리, 캔버스, 인증, 실시간 공동 편집과 댓글은 아직 구현하지 않았습니다.

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

웹·API·DB는 기본적으로 로컬 주소에만 바인딩합니다. `.env.example`의 계정은 로컬 개발 전용입니다. 사내 배포 전에 인증·프로젝트 권한·운영 설정을 구현해야 합니다.

## 명령어

| 명령 | 동작 |
| --- | --- |
| `pnpm dev` | 공통 패키지·웹·서버를 변경 감지 모드로 실행 |
| `pnpm check` | 타입 검사, 모델 테스트, 전체 빌드 |
| `pnpm typecheck` | 공유 패키지를 준비한 뒤 전체 타입 검사 |
| `pnpm test` | 모델 규칙 단위 테스트 |
| `pnpm build` | 의존 순서대로 공유 패키지·서버·웹 빌드 |
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

현재 마이그레이션은 프로젝트 메타데이터 테이블만 만듭니다. 사용자가 캔버스에서 설계할 테이블을 앱 DB에 실제 테이블로 생성하는 기능은 아닙니다.

## 연결 문제 확인

- 웹의 API 상태가 '확인 필요': `pnpm dev`의 서버 로그와 `.env`의 `PORT`를 확인합니다.
- DB 상태가 '확인 필요': `pnpm db:up`과 `pnpm db:migrate`를 실행한 뒤 '다시 확인'을 누릅니다.
- API 실행 확인은 DB가 없어도 200을 반환합니다. 준비 확인은 DB나 마이그레이션이 준비되지 않았으면 503을 반환합니다.
- `DATABASE_URL`이나 서버 설정을 수정한 경우 개발 서버를 재시작합니다. DB 계정 정보를 바꾸면 Compose 설정과 URL을 함께 맞춰야 합니다. 이미 초기화된 DB의 비밀번호는 환경 변수 변경만으로 바뀌지 않습니다.
- Docker 자체가 시작되지 않으면 앱과 별도의 문제입니다. 이번 Windows 소켓 오류의 확인·복구 기록은 [개발 환경 검증 기록](./docs/SETUP_VERIFICATION.md)을 참고합니다.

## 개발 문서

- [요구사항](./REQUIREMENTS.md)
- [논리·물리 통합 데이터 모델](./DATA_MODEL.md)
- [기술 스택과 구현 상태](./TECH_STACK.md)
- [Drizzle 첫 단계](./docs/DRIZZLE_START.md)
- [환경 검증 기록](./docs/SETUP_VERIFICATION.md)
