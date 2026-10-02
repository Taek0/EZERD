# 전체 테이블 캔버스와 테이블 색상 웹 통합

## 작업 범위

[구현 계획](../planning/2026-10-01-Canvas-DirectTableImplementation.md)에 따라 `apps/web/src`의 화면·웹 헬퍼·회귀 테스트만 변경했다. 모델·계약·서버는 주 작업 및 별도 에이전트의 범위다. 주 작업에서 변경과 최종 브라우저 QA를 검토하고 이 작업 단위를 커밋한다.

## 구현 결과

- 빈 프로젝트와 도메인 없는 프로젝트는 `TABLES_VIEW_ID` 전체 캔버스로 시작한다. 도메인이 있는 프로젝트의 도메인 맵 시작은 유지했다. 툴바에서 두 화면을 오갈 수 있다.
- 전체 캔버스는 모든 물리 테이블과 관계를 표시하며, 생성·붙여넣기는 `domainId: null`을 사용한다. 도메인 화면에서 생성하면 해당 소유 도메인을 그대로 지정한다.
- 전체 캔버스의 노드 이동·크기·관계선·자동 배치는 공유 설계 편집 권한을 따른다. 기존 통합 도메인 뷰의 개인 관계선 권한은 유지했다.
- 사라진 뷰의 요청 상태를 유효한 시작 뷰로 갱신하고, 현재 화면에서 보이지 않는 선택·컨텍스트 메뉴·FK 연결 상태를 정리한다. 권한·뷰 전환 시 진행 중인 연결과 메뉴도 닫는다.
- 테이블 소유 도메인 선택에 미지정을 추가했다. 빈 문자열 대신 센티널을 사용하며 소유 도메인 선택값을 인코딩해 센티널과 같은 도메인 ID도 선택할 수 있다.
- 기존 도메인 색상 선택기를 재사용해 테이블 색상과 자동 색상 초기화를 제공했다. 표시 우선순위는 테이블 색상 → 도메인 색상 → `#8993a3`이다. 밝고 어두운 색 모두 대비를 확보하도록 헤더의 흑백 글자색을 선택한다.
- 전체 캔버스의 카드 헤더와 목록에 소유 도메인/미지정을 색상과 별도로 표시한다. 전역 화면에는 외부 참조 표시와 참조 전용 안내를 표시하지 않는다. 실제 외부 도메인 카드의 참조 구분은 유지한다.
- 복사/붙여넣기는 색상, 컬럼·키·내부 관계, 선택 화면의 상대 위치·크기와 별도 전체/소유 도메인 배치를 보존한다. 기존 소유 도메인 배치만 있는 클립보드도 계속 수용하며 중복·잘못된 뷰 배치는 거부한다.
- 전체 캔버스의 댓글 핀, 도메인 없는 테이블의 DDL 진단 이동, 전체 화면 PNG 이름, 도메인 뷰에서 전체 캔버스로 돌아오는 경로를 대응했다. nullable 소속이 통합 관계/참조 헬퍼로 전달될 때의 타입·필터도 수정했다.

## 변경 파일

- `apps/web/src/features/canvas/`: `Canvas.tsx`, `Canvas.test.ts`, `canvas-view.ts`, `canvas-view.test.ts`, `table-clipboard.ts`, `table-clipboard.test.ts`, `translations.ts`
- `apps/web/src/features/tables/`: `TableEditor.tsx`, `TableEditor.test.ts`, `table-editor.css`, `table-appearance.ts`, `table-appearance.test.ts`, `ddl-diagnostics.ts`, `ddl-diagnostics.test.ts`, `translations.ts`
- `apps/web/src/features/domains/`: `DomainColorPicker.tsx`, `domain-view.ts`
- `apps/web/src/features/relations/`: `prepare-table-relations.ts`, `prepare-table-relations.reference.ts`, `prepare-table-relations.test.ts`
- `apps/web/src/features/comments/`: `comments-state.ts`, `comments-state.test.ts`
- `apps/web/src/shared/api/`: `client.ts`

## 검증

- 변경 경로에 루트 Prettier 설정 적용.
- `pnpm --filter @ezerd/web typecheck` 통과.
- `pnpm exec vitest run apps/web/src`: 57개 테스트 파일, 347개 테스트 통과.
- `pnpm --filter @ezerd/web build` 통과.
- `git diff --check -- apps/web/src` 통과.

추가 회귀 검증은 시작 화면/유효 뷰, 직접 생성과 기존 소유 도메인 생성, 미지정 전환 후 표시와 배치 보존, 공유/개인 권한 분리, 색상 상속·초기화·대비, 소유 선택 센티널 충돌, 전역 소속 표시, 읽기 전용 색상 제어, nullable 복사/붙여넣기와 두 배치 크기, 미지정 FK 관계, 전역 핀, DDL 진단 이동을 다룬다.

## 통합 확인 사항

웹은 서버/주 작업에서 정규화된 문서를 전달받는 기준을 사용한다. 렌더링 중 `ensureTableCanvasLayout` 호출·저장 효과를 추가하지 않았다. 서버의 로드와 동기화 기준 문서가 같은 정규화 규칙을 쓰는 것은 서버 및 실제 DB 테스트에서 검증했다.

## 최종 브라우저 QA

- Browser 스킬의 로컬 테스트 화면에서 도메인 없는 `users` 생성, 테이블 색상 지정, 도메인 맵 전환·`Sales` 생성·도메인 색상 지정·소속 화면에서 `orders` 생성을 확인했다.
- 전체 캔버스에서 두 테이블과 별도 소속 표시를 확인했다. `users`의 도메인 지정 후 직접 색상 유지, 자동 초기화 후 도메인 색상 상속, 다시 미소속으로 변경 후 기존 전체 좌표 유지를 확인했다.
- 컬럼 추가·전체 캔버스 자동 배치·확대/축소도 조작했다. 색상 헤더의 소속 배지는 기존 전역 `small` 스타일 대신 헤더의 대비 색상을 상속하도록 보완하고 실제 계산 스타일을 확인했다.
- 공유 메뉴의 실제 PNG 생성 경로를 실행해 `전체 테이블-2x.png` 62,076바이트를 생성하고 픽셀을 확인했다. 기본 브라우저의 다운로드 이벤트 확인은 시간 초과되어 격리 QA 페이지에서 생성된 다운로드 앵커의 Blob을 캡처했다. 테이블 색상·소속 배지·INTEGER 컬럼은 정상 보존됐다.
- 임시 QA HTML은 검증 후 삭제한다. 운영 프로젝트 데이터를 만들거나 변경하지 않았다.
