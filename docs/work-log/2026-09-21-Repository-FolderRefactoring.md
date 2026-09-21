# 저장소 폴더 구조 정리 구현 기록

작성일: 2026-09-21

## 기준과 범위

- 기준 커밋: `a3efa1e` (`main`)
- 기존 계획: `docs/planning/2026-09-17-Repository-FolderRefactoring.md`
- 이번 작업은 동작 변경 없이 `apps/web`과 `apps/server` 내부의 기능별 파일 이동 및 import 경로 갱신만 수행했다.
- `packages/model`, `packages/contracts`, `components/ui`의 공개 경계와 `docs/EZERD.txt`는 변경하지 않았다.

## 변경 내용

### 웹

- `apps/web/src/app/`: 애플리케이션 조립과 autosave 테스트
- `apps/web/src/features/canvas/`: 캔버스, 선택, 카메라, inspector 상태와 PNG 출력
- `apps/web/src/features/tables/`: 테이블·컬럼·키·enum 편집
- `apps/web/src/features/relations/`: 관계선·routing·FK 대화상자
- `apps/web/src/features/domains/`: 도메인 편집·관계·결합 뷰
- `apps/web/src/features/collaboration/`: 동기화·큐·저장소·히스토리
- `apps/web/src/features/comments/`: 핀·댓글 패널·댓글 상태
- `apps/web/src/features/projects/`: 프로젝트 전송
- `apps/web/src/features/identity/`: 사용자 색상
- `apps/web/src/features/mcp/`: MCP 연결 패널
- `apps/web/src/shared/api/`, `shared/editor/`, `shared/hooks/`: API 클라이언트, 편집기 패널 primitive, 패널 닫기 hook
- `apps/web/src/styles/`: 전역·편집기 스타일
- QA HTML과 `scripts/*.mjs`에 포함된 `/src/...` 경로를 새 위치에 맞게 갱신했다.

### 서버

- `apps/server/src/workspace/`: workspace controller/service
- `apps/server/src/sync/`: HTTP controller, WebSocket gateway, sync service
- `apps/server/src/review/`: review controller/service
- `apps/server/src/identity/`: session과 user conflict 처리
- `apps/server/src/network/`: LAN 접근 제어와 CIDR 정책
- `apps/server/src/shared/`: 여러 기능이 사용하는 rate limit service
- 기존 `db/`, `mcp/`와 루트 bootstrap 파일은 유지했다.
- Nest provider 등록과 API/데이터 모델은 변경하지 않고 `AppModule` 및 테스트 import만 갱신했다.

## 커밋

- `2354664 refactor(web): organize source by feature`
- `c22385f refactor(server): organize source by feature`

## 검증

- `pnpm format:check` 통과
- `pnpm typecheck` 통과
- `pnpm test` 통과: 65개 파일, 342개 테스트 성공 / 3개 파일, 23개 테스트 skip
- `pnpm build` 통과
- 웹 단독 typecheck/build 및 서버 단독 typecheck도 각 이동 직후 통과
- Vite의 기존 번들 크기 경고는 남아 있으나 폴더 이동과 무관하다.

## 후속 작업

- `App.tsx`, `Canvas.tsx`, `TableEditor.tsx`, `sync.service.ts` 내부 책임 분리는 이번 이동과 분리했다.
- `packages/model`·`packages/contracts` 내부 세분화와 `scripts/` 용도별 폴더 이동은 별도 작업으로 남겼다.
