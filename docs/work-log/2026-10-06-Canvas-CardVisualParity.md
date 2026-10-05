# Native 캔버스 카드·관계선 원본 표현 복원

## 범위와 기준

- [전체 복원 계획](../planning/2026-10-06-Canvas-CompleteParityRestoration.md)의 카드·행·도메인·메모·관계선 렌더링 작업 단위다.
- 원본은 `Canvas.tsx`, `TableEditor.tsx`의 `TableNodeContent`, `DomainDescription.tsx`, `TableRelations.tsx`, `table-geometry.ts`와 실제 CSS의 최종 override를 함께 대조했다.
- 네이티브 문서의 DB별 타입·namespace·기본값·generation·scope를 직접 읽는다. 프로덕션 코드에 v1 문서 투영을 추가하지 않았다. 기존 프로젝트 데이터와 `docs/EZERD.txt`는 변경하지 않았다.
- `NativeERDCanvas.tsx`, `NativeProjectView.tsx`, 메뉴·공유/개인 저장·선택 상태의 소유권은 부모 작업에 남겼다. 요청에 따라 브라우저 QA와 전체 `pnpm check`는 실행하지 않았다.

## 원본 대조 목록과 복원 결과

| 항목 | 원본 근거 | Native 복원 |
| --- | --- | --- |
| 카드 표면·선택·모션 | `styles.css`의 `.canvas-node`, `domain-workflow.css` | 원본 node 종류/selected 클래스, neutral 테두리, 종류별 radius·shadow, 160ms opacity/shadow 전환, reduced motion |
| 테이블 제목·소유 도메인 | `TableNodeContent`, `table-appearance.ts`, `table-editor.css` | 50px 컬러 헤더, 흰색 26px/34px 제목, 전체 테이블 화면에만 13px 소유 도메인 배지, 외부 참조/소유 도메인 tooltip |
| 테이블 행·표시 옵션 | `TableNodeContent`, 모델 `tableCardMetrics` | 실제 표시값으로 grid 최소 너비, 20px/28px 행, 34px 컬럼 헤더, 줄바꿈·명시적 개행, NULL/comment 숨김, 빈 컬럼 안내 |
| 키·NULL·타입 | `table-editor.css`, 원본 `Checkbox`/타입 trigger | PK/FK/UQ 순서, 키별 배경과 14px marker, 공통 Checkbox, 물리 PK NULL 변경 차단, 논리 required 구분, Native 타입/default/generation 상세 tooltip |
| 푸터·크기 조절 | 원본 `IconButton`, footer/resize CSS | 공통 추가 버튼과 40px footer, 24px resize 모양, callback 미제공 시 disabled, 기존 Native resize/persist 경로 유지 |
| 도메인 카드 | 원본 `.domain-node`, `DomainDescription` | 5px 상단 색상·8% tint, DOMAIN overline, 28px 제목, 16px/1.55 설명·스크롤, 하단 공통 도메인 열기 버튼, 더블클릭/Enter 이동 |
| 메모 | `editor-feedback.css`, 원본 `DomainDescription memo` | 인공 제목 제거, 3px radius·4px 상단 색상·24% tint, 원본 note body/textarea와 placeholder |
| 설명 편집 | 공통 `DomainDescription` | 더블클릭/Enter 시작, blur·Ctrl/⌘+Enter 저장, Escape 취소, composing 처리, 텍스트 선택·textarea 이벤트 분리. callback 없으면 readOnly, 미저장 도메인 preview는 편집·이동·resize 차단 |
| 테이블 관계선 | `TableRelationsSvg`, `table-relations.css` | 원본 cardinality path·optional circle, 물리 실선/논리 6/4 점선, 14px hit 영역, label 클릭, 140ms stroke 모션·선택 3.5px/label fill·focus·reduced motion |
| 도메인 관계선 | `Canvas.tsx`, `domain-relations.ts` | 공통 port/label geometry, 7px 화살표, 1.7px stroke, 14px label·배경 halo, 밀집 label leader, 선택/focus 색상과 키보드 선택 |
| 여러 캔버스 | 관계선 marker 참조 | `useId`로 table/domain SVG marker 충돌 방지 |
| PNG | Native SVG 내보내기 | 공통 title/namespace/grid/row/label 치수, 실제 개행, 키/타입 서체·색상, NULL checkbox·footer, 도메인/메모 tint·상단 색상·설명, domain leader. XML escaping·2x raster budget·actor/project/download guards 유지 |

원본 `TableNodeContent`의 타입 편집은 PostgreSQL v1 구조를 전제로 한다. 따라서 Native 카드의 이름/comment/F2/타입 trigger는 기존 `onEdit`를 통해 DB별 Native 편집기로 연결하며, Native 타입을 원본 PostgreSQL 목록으로 축소하지 않는다. 공통 `DomainDescription`, `Checkbox`, `Button`, `IconButton`은 직접 재사용했다.

## 부모 통합 계약

- `selectedObjectIds`, `onNodeSelect`, `onNodeContextMenu`를 추가했다. Ctrl/Shift/Meta 클릭을 위임하고, wrapper focus/제목 버튼이 다중 선택을 덮어쓰지 않는다. 컬럼 이름 버튼의 modifier 클릭도 wrapper까지 전달한다.
- `selectedColumnId`로 행 선택을 표시한다. `onConnectFromColumn(columnId)`는 물리 PK marker의 연결 affordance에 사용한다. 행에는 `data-column-id`를 유지해 부모 context menu가 같은 컬럼을 식별할 수 있다.
- `onDescriptionCommit(objectId, value)`가 제공될 때만 도메인·메모를 편집한다. 부모는 권한·busy·draft 기준에 따라 callback 자체를 생략하고 Native durable 명령 배치로 저장해야 한다.
- `onToggleNullable(tableId, columnId, value, mode)`가 제공될 때만 Checkbox를 변경할 수 있다. physical value는 NULL 허용, logical value는 required다. 물리 PK는 callback이 있어도 disabled다.
- 부모의 displayed bounds는 `nativeTableCanvasMetrics(document, table, mode).width/height`를 사용해야 한다. 관계선 컬럼 앵커는 이전 78px 대신 `nativeTableCanvasHeaderHeight`(84px)와 동일한 row heights를 사용한다. 라우팅 label 폭도 `nativeRelationLabelWidth`를 사용한다.
- 도메인 화면의 배치 identity는 `__tables__`를 유지하되 scene에 선택적 `effectiveView`를 보존하면 PNG의 전체 테이블 전용 owner/schema 배지와 DOM의 표시가 일치한다.
- 기본 React `memo`는 새 선택·callback props를 모두 비교한다. 카메라 좌표를 Scene에 전달하지 않는 기존 경계를 유지했다. 부모 callback은 `useCallback`으로 안정화해야 pan 동안 callback identity 때문에 재렌더링하지 않는다.
- 이동 step은 원본처럼 1px, Shift+방향키 10px다. 그룹 이동/저장과 부모 guard는 `actions.current` 경로를 유지한다.

## 검증

- 집중 Vitest: `NativeCanvasScene.test.ts`, `NativeCanvasTableRows.test.ts`, `NativeTableLines.test.ts`, `native-canvas-decoration.test.ts`, `native-canvas-png.test.ts`: **5개 파일, 41개 테스트 통과**.
- 동등한 표시값의 native grid/width/height/row heights를 원본 `tableCardMetrics` 결과와 비교했다. 이 비교용 v1 fixture는 테스트에만 존재한다.
- PostgreSQL/MySQL/SQLite opaque 원문 타입/default 보존, 물리/논리 이름 fallback, 이름 없는 카드, PostgreSQL 기본 public/명시 schema, MySQL·SQLite·legacy namespace에 PostgreSQL badge를 만들지 않는 경우를 확인했다. DOM과 PNG의 동일한 helper를 검사했다.
- PK NULL guard의 synthetic change 방어, logical required, 선택 modifier 전파, original keyboard step, 미저장 domain preview guard, context menu/Enter navigation, 다중 SVG marker, 밀집 label leader를 검사했다.
- PNG XML escaping·native payload 불변성·행 개행·표현 치수·effective domain view·2x PNG 생성 및 컨텍스트 변경 후 다운로드 차단 회귀를 유지했다.
- 담당 TS/TSX와 테스트를 include하는 임시 web tsconfig로 초기 scoped `tsc --noEmit`를 통과했고 임시 파일을 제거했다. 최종 반복 검사에서는 병렬 작업 중 변경된 의존 파일 `native-inline-edit.ts:47`의 문자열 typeId와 `NativeERDCanvas.tsx:1794`의 PNG export `filter` prop에서 오류가 발생했다. 담당 파일의 타입 오류는 없었으며 의존 파일을 수정하지 않았다. 집중 Prettier와 `git diff --check` 검사는 통과했다.
- 웹 패키지 전체 타입검사에서는 당시 병렬 작업 중인 `native-canvas-selection.test.ts` 오류가 남았다. 담당 파일의 타입 오류는 없었으며 이 파일은 수정하지 않았다. 통합 검증은 부모가 수행한다.

브라우저/pixel QA는 사용자가 선택한 코드·서버 검증 범위에 따라 수행하지 않았다. PNG는 DOM 화면 캡처가 아닌 기존 SVG serializer를 유지하며 폰트별 실제 글자 폭 대신 원본 metrics 기준으로 줄을 나눈다. 실제 브라우저의 폰트·색 혼합·그림자 픽셀까지 동일하다고 주장하지 않는다. 저장 ACK·권한·그룹 조작·패널·메뉴의 통합 완료 여부는 부모 작업의 결과 기록에서 확인해야 한다.
