# 저장소 폴더 정리와 책임 분리 계획

작성일: 2026-09-17
상태: 계획만 작성. 파일 이동·코드 분리·삭제는 미실행.
검토 기준: 로컬 `main`의 `69d2143`, 작업 시작 시 변경 없는 작업 트리. 원격 조회 없이 현재 소스·설정·스크립트를 확인했다.

## 목적과 범위

기능 코드를 찾고 변경 범위를 판단하기 쉽게 만들고, 소스·테스트·스타일·운영 스크립트의 소유 위치를 명확히 한다. `apps/web`, `apps/server`, `packages/model`, `packages/contracts`의 workspace 경계와 공개 API는 유지한다. 폴더 정리 자체를 성능 개선으로 간주하지 않는다.

이번 요청의 산출물은 이 계획과 문서화 작업 기록이다. 아래 구조는 후속 구현 시 적용할 목표이며 전체를 한 번에 옮기지 않는다. 불필요한 추상화, 전역 상태 도구 도입, 의존성 업그레이드, 데이터 모델·API 변경은 별도 작업으로 다룬다.

## 현재 구조와 문제

| 위치 | 확인한 상태 | 정리 방향 |
| --- | --- | --- |
| `apps/web/src` | `App.tsx`, `Canvas.tsx`, `TableEditor.tsx`와 도메인·관계·컬럼·동기화·핀·내보내기 코드, 테스트, CSS가 루트에 섞여 있다. | 기능별로 구현·테스트·스타일을 함께 배치한다. 큰 컴포넌트 내부 책임 분리는 이동 후 별도 커밋으로 수행한다. |
| `apps/web/src/components/ui` | 공통 컴포넌트, 스타일, 출처·라이선스 메타데이터가 이미 모여 있다. | 기존 위치와 출처 정보를 유지한다. 기능 코드를 공통 UI로 옮기지 않는다. |
| `apps/server/src` | `db`, `mcp`는 분리되어 있고 workspace·sync·review·session 및 네트워크 코드가 루트에 있다. `app.module.ts`가 provider를 직접 등록한다. | 기능 파일을 묶되 첫 이동 단계에서 Nest 모듈·DI 구조는 바꾸지 않는다. |
| `packages/model`, `packages/contracts` | 별도 패키지와 `src/index.ts` 공개 진입점을 사용한다. | 공개 import 경로를 유지한다. 내부 분할은 실제 책임·참조 검토 후 후순위로 진행한다. |
| `scripts` | 개발 준비, 호스팅, 문서 생성, DB 검증, 브라우저 smoke, QA HTML 생성기가 한곳에 있다. | 용도별 하위 폴더로 나누고 실행 진입점과 상대 경로를 함께 수정한다. |
| `docs` | `planning`·`work-log` 분류와 README 안내가 있다. | 기존 분류를 유지하고 주요 계획의 링크를 추가한다. 과거 기록을 대량 이동·개명하지 않는다. |
| 루트 `src`, `deploy` | 폴더는 존재하지만 검토 시 `git ls-files src deploy`에 추적 파일이 없었다. | 미사용이라는 근거로 삼지 않는다. 내용·생성 주체·사용 여부 확인 전 삭제하지 않는다. |
| `.data`, `.cache`, `artifacts`, `dist`, 외부 자산 | 실행 상태·캐시·검증 산출물·생성물·외부 파일은 소스와 수명 주기가 다르다. | 일괄 이동·삭제 대상에서 제외한다. 별도 정리 시 추적 여부와 보존 정책부터 확인한다. |

## 웹 목표 구조

다음은 책임별 목표이며 새 폴더는 실제로 파일을 이동할 때 만든다. 모든 파일을 일괄적으로 이름까지 바꾸지 않는다.

```text
apps/web/src/
  main.tsx                  # 기존 HTML 진입 경로 유지
  app/                      # App, 전체 화면 조립과 공통 레이아웃
  features/
    canvas/                 # Canvas, 카메라 입력, 선택, 캔버스 PNG 출력
    tables/                 # 테이블·컬럼·키·enum 편집과 카드 치수
    relations/              # 테이블 관계선, 경로 계산, FK 대화상자
    domains/                # 도메인 설명·색상·뷰 구성·도메인 관계
    collaboration/          # 동기화, 저장 큐, 변경 이력
    comments/               # 핀·댓글·패널 크기
    projects/               # 프로젝트 전송 UI와 데이터 변환
    identity/               # 사용자 색상 등 식별 UI
    mcp/                    # MCP 연결 패널
  shared/                   # 여러 기능이 사용하는 도메인 비의존 도구
  styles/                   # tokens 및 전역 스타일
  components/ui/            # 기존 공통 UI와 출처 파일 유지
```

| 현재 파일 예 | 목표 위치와 처리 |
| --- | --- |
| `App.tsx` | `app/App.tsx`; `main.tsx`와 QA 생성 HTML의 import를 함께 수정한다. |
| `Canvas.tsx`, `canvas-wheel.*`, `canvas-state.*`, `canvas-export.ts` | `features/canvas/`; 입력·카메라·캔버스 조립 책임을 모은다. |
| `TableEditor.tsx`, `table-geometry.*`, `column-*`, `EnumManager.tsx` | `features/tables/`; 첫 단계에는 그대로 이동하고 카드·인스펙터·편집기 분리는 후속 작업으로 한다. |
| `TableRelations.tsx`, `relation-routing*`, `table-relation-label.*`, `ForeignKeyDialog.tsx`, `foreign-key-draft.*` | `features/relations/`; 테이블 편집과의 상호 import 및 기존 재수출을 먼저 조사한다. |
| `domain-*`, `DomainDescription.tsx`, `DomainColorPicker.tsx` | `features/domains/`; 도메인 배치와 관계 이름 계산 테스트를 함께 둔다. |
| `sync-*`, `document-history.*`, `autosave-ui.test.ts` | `features/collaboration/`; 기존 함수 API를 유지하고 캔버스와의 경계 테스트도 보존한다. |
| `CommentsPanel.tsx`, `comments-*`, `PinPanelResizer.tsx`, `pin-request.*` | `features/comments/`; 해당 CSS와 테스트를 같이 이동한다. |
| `ProjectTransfer.tsx`, `project-transfer.*`, `McpConnectionPanel.tsx`, `UserColorEditor.tsx`, `user-color*` | 각각 `projects`, `mcp`, `identity`로 묶는다. |
| `client.ts`, `panel.tsx`, `use-panel-dismiss.ts`, `inspector-state.*`, `ddl-diagnostics.*` | 여러 책임이 섞였는지 호출자를 확인한 뒤 배정한다. 이름만 보고 `shared`로 일괄 이동하지 않는다. 인스펙터 상태는 canvas, DDL 진단은 tables를 우선 검토한다. |

테스트는 기본적으로 구현 옆에 유지한다. 여러 기능의 경계를 검증하는 테스트는 책임을 가진 기능에 두고 위치가 모호한 경우 후속 검토로 남긴다. 현재 Vitest는 `src/**/*.test.ts`를 수집하므로 하위 폴더 이동은 수집 범위 안이지만, `.test.tsx`로 확장자를 바꾸면 별도 설정 변경이 필요하다.

## 의존성 원칙

- `app`과 캔버스 화면이 기능을 조립하고, `components/ui`·일반 `shared` 도구는 기능 컴포넌트를 import하지 않는다.
- 기능 간 의존성은 필요한 순수 함수·타입을 명시적으로 import한다. `tables`와 `relations`가 서로 UI를 import하면 조립 코드를 상위로 옮기거나 순수 계산을 분리한다. 실제 순환 여부를 확인하지 않은 채 디렉터리만 나누어 해결됐다고 판단하지 않는다.
- 패키지 외부에서는 기존 `@ezerd/model`, `@ezerd/contracts` 공개 진입점을 사용한다. `src` 또는 `dist` 내부 경로를 새로 노출하지 않는다.
- 상대 import의 기존 `.js` 확장자 관례를 유지한다. 폴더 이동과 함께 path alias 또는 대규모 barrel export를 도입하지 않는다.
- CSS는 현재 import 순서를 유지한다. 기능 CSS 이동과 선택자·우선순위 재설계를 같은 커밋에 섞지 않는다. `main.tsx`의 전역 스타일과 QA HTML의 직접 CSS import를 함께 점검한다.

## 서버·스크립트 목표

서버는 루트에 `main.ts`, `application.ts`, `app.module.ts`, `config.ts`, `health.controller.ts`를 유지하고 `workspace/`, `sync/`, `review/`, `identity/`, `network/`로 관련 파일을 묶는다. 기존 `db/`, `mcp/`는 유지한다. `rate-limit.service.ts`, `user-conflicts.ts`처럼 여러 기능에서 쓰는 파일은 실제 소비자를 조사한 뒤 network 또는 identity 등 소유 위치를 정한다. `session.ts`의 controller/service 분리는 단순 이동과 별도 커밋으로 한다. 서버 테스트는 기존 `apps/server/test`를 유지하고 import 경로만 갱신한다.

| 현재 스크립트 | 목표 폴더 |
| --- | --- |
| `setup.mjs`, `import-fonts.mjs` | `scripts/setup/` |
| `host-lan.mjs` | `scripts/hosting/` |
| `document-versions.mjs`, `document-ui-licenses.mjs` | `scripts/docs/` |
| `verify-postgres-export.mjs`, `verify-user-uniqueness.mjs` | `scripts/verification/` |
| `browser-*-smoke.mjs`, `browser-smoke.mjs`, `browser-select.mjs` | `scripts/qa/browser/` |
| `prepare-*-qa.mjs` | `scripts/qa/fixtures/` |

`apps/server/scripts`는 해당 패키지 소유로 유지한다. 루트 `package.json`의 `pnpm setup`, `pnpm host:serve`, `pnpm docs:versions` 같은 명령 이름은 보존하고 내부 파일 경로만 갱신한다. 문서에 공개된 직접 `node scripts/...` 명령은 현재 운영 안내를 수정한다. 과거 작업 기록의 실행 경로는 당시 기록으로 유지하고 새 작업 기록에 변경 전후 경로를 안내한다. 호환 wrapper가 필요하면 사용자와 제거 조건을 명시하고 중복 구현은 만들지 않는다.

## 이동 시 반드시 확인할 경로

- `import`, `export ... from`, 동적 import, 테스트 mock 경로, 문자열 안의 `/src/...` 참조를 모두 조사한다. QA 생성기에는 `App.tsx`, CSS 경로가 HTML 문자열로 들어 있다.
- `new URL(..., import.meta.url)`과 실행 `cwd`에 의존하는 스크립트 경로를 보정한다. 중첩 폴더로 옮기면 `../apps/web`과 저장소 루트 기준이 달라진다. fixture 생성·`--clean`이 같은 의도한 파일을 가리키는지 확인한다.
- `application.ts`의 `../../web/dist/` 정적 자산 경로와 `dist/main.js` 실행 계약을 보존한다. TS 컴파일 성공만으로 LAN 호스팅 경로 보존을 판단하지 않는다.
- `package.json`, `pnpm-workspace.yaml`, TS/Vite/Vitest 설정, 스크립트 내 subprocess 호출, 현재 실행 안내, `.gitignore`·`.prettierignore` 경로를 점검한다.
- Windows에서 이동한 이름이 Linux의 대소문자 구분에서도 일치하는지 확인한다. 대소문자만 바꾸는 이름 변경은 이번 정리에서 피한다.
- `public`, `third-party`, `components/ui/UPSTREAM.json`·라이선스 파일, Drizzle 생성물, `docs/EZERD.txt`는 이동·수정하지 않는다.

## 단계별 진행과 완료 조건

| 단계 | 변경 단위 | 완료 조건 |
| --- | --- | --- |
| 0. 참조 조사 | 이동 목록, 경로 참조, 기능 간 의존성, 기존 검사 결과를 기록한다. | 각 파일의 새 소유 위치와 보류 항목, 기준 커밋이 명확하다. 기능 변경 없이 이동 가능한 첫 묶음을 선정한다. |
| 1. 독립 웹 기능 | project 전송·색상 UI 등 실제 참조가 단순한 묶음부터 소스·테스트·CSS를 이동한다. | 해당 테스트·타입·빌드 통과, 직접 `/src` 참조 갱신, CSS 순서 유지. 한 기능 단위로 커밋한다. |
| 2. 편집기 관련 묶음 | 테이블·관계·도메인·캔버스·동기화 순서는 의존성 조사 결과에 따라 정한다. | 순환 의존성을 새로 만들지 않고 기존 공개 함수·뷰·편집·내보내기 동작을 유지한다. 파일 이동과 내부 분리를 별도 커밋으로 한다. |
| 3. 스크립트 | 위 용도별로 한 묶음씩 이동하고 호출 경로를 갱신한다. | 명령 진입점 유지, JS 구문·상대 경로 검증, 안전한 메모리 fixture 생성·정리 확인. 실제 DB·사용자 변경 스크립트는 경로 확인을 위해 실행하지 않는다. |
| 4. 서버 | 기능별 파일 이동 후 provider import와 테스트 참조를 갱신한다. | 타입·빌드·해당 테스트 통과. 격리된 환경에서 API·WebSocket·MCP 및 정적 자산 제공을 검증하고 미실행 항목은 기록한다. |
| 5. 책임 분리 | `Canvas.tsx`, `TableEditor.tsx`, `App.tsx`, 필요 시 패키지 내부의 책임을 하나씩 추출한다. | 조립·계산·UI 책임을 설명할 수 있고 기존 테스트가 유지된다. 순수 이동과 성능 최적화가 섞이지 않는다. 불필요한 패키지 세분화는 보류한다. |
| 6. 종합 확인 | 문서·진입점·남은 임시 호환 경로를 검토한다. | `pnpm check` 통과, 테스트 수집 누락 없음, 기능별 검증과 남은 제약 기록. 새 checkout에서도 기존 명령으로 빌드 가능한지 확인한다. |

각 단계 안에서도 작고 독립적인 완료 단위마다 커밋하고 다음 묶음으로 넘어간다. 이동은 가능하면 `git mv`로 수행하고 변경 내용은 `git diff --find-renames`로 검토한다. 실패하면 다음 묶음으로 진행하지 않고 해당 이동 단위를 수정하거나 되돌린다. 다른 작업자의 변경은 포함하지 않는다.

## 검증과 성능 계획의 관계

- 단순 파일 이동을 위해 구현을 그대로 복제하는 테스트는 추가하지 않는다. 기존 테스트의 경로와 수집 수를 비교하고, 책임 추출로 경계가 바뀐 경우에만 의미 있는 테스트를 보완한다.
- 브라우저 자동화 없이 타입·단위·빌드·경로 점검부터 수행한다. 화면 확인이 필요한 CSS·포커스·PNG 항목은 수동 검증 대상으로 남기고 미확인을 완료로 기록하지 않는다.
- 서버 통합·DDL 검증은 필요한 변경에 한해 격리된 테스트 환경으로 수행한다. 단순 정리를 위해 운영 데이터나 사용자 식별 정보를 변경하지 않는다.
- 루트 설정에 따라 `pnpm format`, `pnpm format:check`를 수행하고 무관한 대규모 포맷 변경은 분리한다. 제외된 생성물·외부 자산은 포맷하지 않는다.
- [캔버스 성능 계획](./2026-09-17-Canvas-Performance.md)의 계산 계측에 필요한 최소 순수 함수 추출은 먼저 진행할 수 있다. 폴더 정리 전체를 성능 측정의 선행 조건으로 만들지 않는다.
- 동일 파일의 경로 이동과 캐시·렌더 최적화는 별도 커밋으로 수행한다. 파일 이동을 먼저 적용했다면 성능 비교 기준 커밋을 갱신하고 경로 이동만으로 측정 동작이 바뀌지 않았는지 확인한다.

후속 구현 기록은 `docs/work-log/YYYY-MM-DD-Repository-FolderRefactoring.md`에 기준·변경 커밋, 이동 전후 경로, 참조 수정, 검증 명령·결과, 미확인 사항과 보류 항목을 남긴다.
