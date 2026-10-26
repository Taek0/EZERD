<p align="center">
  <img width="1560" height="285" alt="EZERD" src="https://github.com/user-attachments/assets/fd3b48ca-e0c7-40cb-97e0-58823d1009bf" />
</p>

# EZERD

도메인 관계부터 테이블·컬럼까지 함께 설계하는 팀 협업 ERD 도구입니다.

## 주요 기능

- **설계**: 도메인·테이블 캔버스, 물리·논리 보기, 컬럼·키·관계·ENUM 편집.
- **배치**: 여러 객체 선택·이동, 관계선 직접 편집과 자동 정리, 도메인 필터.
- **협업**: 워크스페이스·초대·역할별 권한, 자동 저장·실시간 동기화, 핀 대화·알림·히스토리.
- **파일**: 프로젝트 JSON 내보내기·가져오기, 고화질 PNG 저장. JSON에는 계정·대화·히스토리가 포함되지 않습니다.
- **MCP**: AI 클라이언트에서 설계 조회·편집·진단과 워크스페이스·프로젝트 관리.

PostgreSQL·MySQL·SQLite와 RDBMS **선택 안함**을 지원합니다. 선택 안함은 가벼운 구조 모델링용이며 DDL 내보내기가 비활성화됩니다. 설계 문서는 JSONB로 저장하며, 캔버스의 테이블이 실제 DB 테이블로 생성되지는 않습니다.

## 빠른 시작

Node.js **24.18.1 이상 25 미만**, pnpm **11.24.0**, 실행 중인 Docker Desktop이 필요합니다.

```powershell
pnpm install --frozen-lockfile
pnpm setup
pnpm db:up
pnpm db:migrate
pnpm db:check
pnpm dev
```

- 웹: <http://127.0.0.1:5173> · API 상태: <http://127.0.0.1:3001/api/health/ready>
- `pnpm setup`은 기존 파일을 덮어쓰지 않고 `.env`를 준비합니다.
- DB는 `127.0.0.1:55432`의 `ezerd`이며, 데이터는 `.data/postgres`에 보존됩니다.
- 사용자명과 네 자리 PIN으로 접속한 뒤 워크스페이스를 만들거나 초대를 수락합니다.

이후에는 `pnpm db:up`과 `pnpm dev`로 실행합니다. 새 마이그레이션이 있으면 `pnpm db:migrate`도 실행하세요. 개발 서버는 `Ctrl+C`, DB는 `pnpm db:stop`으로 종료합니다.

LAN 호스팅과 MCP 연결은 [호스팅 안내](./docs/work-log/LAN_HOSTING.md)를 참고하세요. MCP는 기본적으로 비활성화되어 있습니다.

호스팅은 Docker 실행 및 의존성 설치 후 `pnpm host`로 시작합니다. 기존 `.env`를 보존하면서 DB 컨테이너 준비·빌드·마이그레이션을 자동 진행합니다. 기존 Compose DB는 재사용하고, 중지된 DB는 시작하며, 없는 경우 생성합니다.

## 개발 명령

| 명령 | 용도 |
| --- | --- |
| `pnpm check` | 포맷·타입 검사, 단위 테스트, 전체 빌드 |
| `pnpm test:regression` | 임시 PostgreSQL DB에서 전체 통합 테스트 |
| `pnpm build` | 공유 패키지·서버·웹 빌드 |
| `pnpm format` / `pnpm format:check` | 포맷 적용 / 검사 |
| `pnpm db:generate` / `pnpm db:migrate` | 마이그레이션 생성 / 적용 |
| `pnpm host` / `pnpm host:start` | DB 자동 준비·빌드·마이그레이션 후 LAN 서비스 실행 |

회귀 테스트에는 로컬 PostgreSQL과 임시 DB 생성 권한이 필요합니다. 전체 명령은 [package.json](./package.json)을 참고하세요.

## 구조와 문서

React · TypeScript · Vite · NestJS · PostgreSQL · Drizzle ORM을 사용합니다.

```text
apps/web/           웹 UI·캔버스
apps/server/        API·인증·동기화·MCP
packages/model/     설계 모델·검증·배치
packages/contracts/ API 계약과 타입
docs/               계획·작업 기록·운영 안내
```

- [문서 안내](./docs/README.md)
- [사용 안내](./docs/work-log/USER_GUIDE.md) · [호스팅·MCP 연결](./docs/work-log/LAN_HOSTING.md)
- [개발 환경](./docs/work-log/DEVELOPMENT_VERSIONS.md) · [환경 문제 확인](./docs/work-log/SETUP_VERIFICATION.md)

## 라이선스

자체 코드는 [MIT](./LICENSE)로 제공합니다. 외부 라이브러리·폰트에는 별도 조건이 적용됩니다. [외부 자산 고지](./apps/web/THIRD_PARTY_NOTICES.md)를 참고하세요.
