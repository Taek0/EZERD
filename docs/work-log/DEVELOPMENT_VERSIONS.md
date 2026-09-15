# 개발 환경 버전 기준

확인일: 2026-09-14. 설치된 도구, 패키지 정의, lockfile, 실행 중인 PostgreSQL 컨테이너를 기준으로 기록했다. 아래 값은 최신 버전을 추천하는 목록이 아니라 이 프로젝트에서 구성·검증한 버전이다.

## 재현에 사용할 버전

| 구분 | 구성 요소 | 기준 버전 | 관리 위치 |
| --- | --- | --- | --- |
| 런타임 | Node.js | 24.18.1 | `.node-version` |
| 패키지 관리자 | pnpm | 11.24.0 | 루트 `package.json`의 `packageManager` |
| 언어 | TypeScript | 6.0.3 | 루트 `devDependencies` |
| 프런트엔드 | React / React DOM | 19.3.0 / 19.3.0 | `apps/web/package.json` |
| 빌드 | Vite / React 플러그인 | 8.3.0 / 6.1.1 | `apps/web/package.json` |
| 공통 UI | React Aria Components | 1.21.1 | `apps/web/package.json` |
| 공통 UI 스타일 | Tailwind CSS / Vite 플러그인 | 4.3.3 / 4.3.3 | `apps/web/package.json` |
| 공통 UI 유틸리티 | tailwind-merge | 3.7.0 | `apps/web/package.json` |
| 서버 | NestJS common / core / platform-express | 모두 12.0.1 | `apps/server/package.json` |
| ORM | Drizzle ORM | 0.45.2 | `apps/server/package.json` |
| 마이그레이션 | Drizzle Kit | 0.31.10 | `apps/server/package.json` |
| DB 드라이버 | node-postgres (`pg`) | 8.23.0 | `apps/server/package.json` |
| 입력 검증 | Zod | 4.6.5 | contracts 및 server 패키지 |
| 단위 테스트 | Vitest | 5.0.0 | 루트 `devDependencies` |
| 병렬 프로세스 실행 | concurrently | 10.0.5 | 루트 `devDependencies` |
| TS 스크립트 실행 | tsx | 4.23.13 | 서버 `devDependencies` |
| 환경 변수 로딩 | dotenv | 17.4.2 | 서버 `dependencies` |
| 데코레이터 메타데이터 | reflect-metadata | 0.2.2 | 서버 `dependencies` |
| 서버 반응형 기반 | rxjs | 7.8.2 | 서버 `dependencies` |
| DB | PostgreSQL | 18.6 | `compose.yaml`, `postgres:18.6` |

`engines.node`는 `>=24.18.1 <25`를 허용하지만, 검증 기준 버전은 24.18.1이다. Node 25 이상을 검증했다고 해석하지 않는다. pnpm은 11.24.0으로 고정한다.

## 타입 정의 패키지

| 패키지 | 버전 |
| --- | --- |
| `@types/node` | 24.13.4 |
| `@types/react` | 19.3.0 |
| `@types/react-dom` | 19.3.0 |
| `@types/pg` | 8.23.1 |

타입 정의의 패치 버전은 런타임과 같을 필요가 없다. 런타임과 별도로 고정하고 타입 검사로 확인한다.

## 내부 패키지

| 이름 | 경로 | 현재 버전 |
| --- | --- | --- |
| `ezerd` | 저장소 루트 | 0.1.0 |
| `@ezerd/web` | `apps/web` | 0.1.0 |
| `@ezerd/server` | `apps/server` | 0.1.0 |
| `@ezerd/model` | `packages/model` | 0.1.0 |
| `@ezerd/contracts` | `packages/contracts` | 0.1.0 |

모든 내부 패키지는 private이며 npm에 배포하지 않는다. 내부 참조는 `workspace:*`로 같은 저장소의 패키지를 연결한다.

## 이 PC에서 확인한 개발 도구

| 구성 요소 | 실제 확인 값 | 비고 |
| --- | --- | --- |
| Windows | 25H2, 빌드 26200.9445 | 현재 검증 호스트 |
| PowerShell | 7.6.5 | 현재 명령 실행 셸 |
| Git | 2.55.0.windows.3 | 소스 관리 |
| npm | 11.16.0 | 설치되어 있으나 이 프로젝트 설치는 pnpm 사용 |
| WSL | 2.7.10.0 | Docker의 Linux 실행 기반 |
| Docker Desktop | 4.83.0, 빌드 234302 | 파일 버전 4.83.0.234302 |
| Docker CLI / Engine | 29.6.2 / 29.6.2 | 컨텍스트 `desktop-linux` |
| Docker API | 1.55 | 서버 최소 API 1.40 |
| Docker Compose | 5.3.1 | 프로젝트 DB 실행 |
| Docker Linux 커널 | 6.18.33.2-microsoft-standard-WSL2 | 서버에서 확인 |
| containerd | 2.2.5 | Docker 내부 구성 요소 |
| runc | 1.3.6 | Docker 내부 구성 요소 |
| docker-init | 0.19.0 | Docker 내부 구성 요소 |
| Docker 빌드 Go | 1.26.5 | CLI·Engine 빌드 정보, 프로젝트 언어 아님 |

Windows·PowerShell·Git·Docker Desktop의 동일한 패치 버전을 팀 전체에 강제하지는 않는다. 다른 환경에서의 지원 여부는 실제 실행·빌드·DB 검증으로 확인한다. Docker Desktop의 알려진 소켓 오류와 이번 복구 내역은 [검증 기록](./SETUP_VERIFICATION.md)에 있다.

## PostgreSQL 이미지 식별

- Compose 지정: `postgres:18.6`
- 실행 바이너리: `PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)`
- 확인한 이미지 digest: `postgres@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`
- 실행 아키텍처: Linux amd64

현재 Compose는 버전 태그를 사용한다. 위 digest는 확인 당시 이미지의 식별값이며 Compose에 digest 고정을 적용한 것은 아니다. 태그 재게시까지 포함한 동일 이미지 재현이 필요하면 이 digest를 기준으로 검토한다.

## Node.js 내장 구성 요소

`process.versions`에서 확인한 값이다. 이 목록을 개별 npm 의존성으로 설치하지 않는다.

| 구성 요소 | 버전 |
| --- | --- |
| Node | 24.18.1 |
| V8 | 13.6.233.17-node.50 |
| OpenSSL | 3.5.7 |
| libuv (`uv`) | 1.52.1 |
| Node module ABI | 137 |
| Node-API | 10 |
| acorn | 8.16.0 |
| ada | 3.4.4 |
| amaro | 1.1.9 |
| c-ares (`ares`) | 1.34.6 |
| brotli | 1.2.0 |
| cldr | 48.0 |
| icu | 78.3 |
| llhttp | 9.4.3 |
| merve | 1.2.2 |
| nbytes | 0.1.4 |
| ncrypto | 0.0.1 |
| nghttp2 | 1.69.0 |
| nghttp3 / ngtcp2 | 빈 값으로 보고됨 |
| simdjson | 4.6.4 |
| simdutf | 6.4.0 |
| sqlite | 3.53.1 |
| tz | 2026b |
| undici | 7.29.0 |
| unicode | 17.0 |
| uvwasi | 0.0.23 |
| zlib | 1.3.1-e00f703 |
| zstd | 1.5.7 |

## 간접 의존성과 lockfile

- 직접·간접 의존성 전체: [패키지 버전 전체 목록](./DEPENDENCY_VERSIONS.md)
- 설치의 기준: [pnpm-lock.yaml](../../pnpm-lock.yaml), lockfile 형식 9.0
- 전체 목록에는 OS별 선택 의존성과 동일 패키지의 여러 버전을 포함한다. 실제 현재 의존성 그래프에서 확인된 항목도 표시한다.
- 무결성 해시, 의존 관계, peer 조합의 상세 정보는 lockfile에 보존한다.
- lockfile을 유지한 설치는 `pnpm install --frozen-lockfile`로 실행한다.

## 폰트 자산

- Apple SD Gothic Neo: 사용자 제공 폰트셋, 원본 TTF의 버전 문자열은 선택한 5개 굵기 모두 `Version 1.0`.
- 실제 배포 자산은 문자별 서브셋이며 별도의 버전 문자열이 제거되어 있다. `apps/web/public/fonts/apple-sd-gothic-neo/manifest.json`의 파일별 SHA-256으로 식별한다.
- 적용 굵기: Regular 400, Medium 500, SemiBold 600, Bold 700, ExtraBold 800.
- 실제 서브셋 형식: WOFF, 600개. 원본의 `.woff2` 확장자를 실제 파일 형식에 맞춰 프로젝트 복사본에서 정정했다.
- 폰트 자산은 npm 패키지가 아니므로 패키지 lockfile 및 의존성 297개 목록과 별도로 관리한다.

## 아직 설치하지 않은 제안 기술

React Flow, Tailwind CSS, shadcn/ui, Yjs, Hocuspocus, Playwright는 현재 설치하지 않았다. 따라서 프로젝트 채택 버전도 아직 없다. 해당 기능을 구현할 때 호환성을 확인하고 설치 버전을 이 문서와 전체 목록에 추가한다.

## 버전 변경 시 갱신 순서

1. 해당 패키지 또는 실행 환경의 버전을 명시적으로 변경한다.
2. `pnpm install`로 lockfile을 갱신한다.
3. `pnpm check`와 필요한 DB·브라우저 검증을 실행한다.
4. `pnpm docs:versions`로 패키지 전체 목록을 재생성한다.
5. 이 문서의 기준 버전과 실제 환경 확인 값을 수정한다.
6. 관련 manifest, lockfile, 버전 문서를 함께 커밋한다.

패키지 목록 생성 명령은 Node.js·Docker·운영체제 버전을 자동 갱신하지 않는다. 호스트 버전은 아래 명령으로 다시 확인한다.

```powershell
node --version
pnpm --version
npm --version
git --version
docker version
docker compose version
docker compose exec -T postgres postgres --version
docker image inspect postgres:18.6 --format '{{json .RepoDigests}}'
```
