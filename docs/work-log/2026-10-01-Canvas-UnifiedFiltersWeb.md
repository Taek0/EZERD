# 공유 전체 테이블 캔버스와 개인 도메인 필터 웹 통합

## 정책 및 구현

- [통합 계획](../planning/2026-10-01-Canvas-UnifiedDomainFilters.md)에 따라 모든 프로젝트를 전체 테이블 캔버스로 연다. 도메인 맵은 유지하고, 도메인을 열면 같은 전체 캔버스에 로컬 필터를 적용한다.
- 활성 화면 ID는 `overview`와 `TABLES_VIEW_ID`만 사용한다. 기존 도메인·함께 보기 링크는 도메인 필터로 해석하고, 테이블 이동은 전체 공유 노드를 기준으로 한다.
- 전체·한 도메인·여러 도메인·미지정·혼합 선택을 지원한다. 필터는 `useState`에만 저장하며 문서 수정, 개인 뷰 생성·갱신, 개인 상태 저장을 호출하지 않는다. 전체 선택은 이후 생성된 테이블도 포함한다.
- 필터 적용 후 숨겨진 단일·다중 선택 및 관계·FK 연결 상태를 정리한다. 목록·관계 수와 PNG 내보내기 이름은 표시된 테이블과 선택한 도메인을 반영한다. 관계는 양쪽 테이블이 모두 보일 때만 표시한다.
- 공유 전체 노드를 사용해 위치·크기·메모·관계선·자동 배치를 편집한다. 자동 배치는 필터에 보이는 테이블만 변경하고 숨겨진 노드는 보존한다. 기존 개인 뷰 배치와 관계선은 편집 경로에서 사용하지 않는다.
- 단일 도메인 선택 시 해당 소속으로 생성한다. 전체·복수·미지정·혼합 선택은 미소속 생성이다. `TableWorkspaceTools.creationOwner`를 명시적으로 전달하며, 직접 생성은 `addTable`의 네 번째 인수로 `TABLES_VIEW_ID`를 지정해 포인터 좌표를 유지한다.
- 제목 흰색·네이티브 입력·우측 도메인 배지는 앞서 적용된 변경을 유지한다.

## 댓글 연동

- `CanvasContext.visibleObjectIds?: string[]` 및 `CommentContext.visibleObjectIds?: string[]`를 제공한다. ID 목록의 값이 같은 경우 배열 참조를 유지하므로 부모 컨텍스트 갱신이 반복 렌더링을 유발하지 않는다.
- `CommentPins.visibleObjectIds?: readonly string[]`로 숨겨진 테이블 핀을 감춘다. 현재 화면 댓글 목록에도 같은 필터를 적용한다. 빈 공유 캔버스 핀과 공유 메모 핀은 유지한다.
- 레거시 도메인 핀과 개인 함께 보기의 테이블 핀은 전체 공유 노드 좌표를 따른다. 이관된 공유 메모 ID도 전체 노드를 기준으로 계산한다.
- 개인 메모·개인 함께 보기의 빈 좌표 핀을 공유 전체 캔버스에 표시하지 않는다. 서버 읽기 권한과 핀 투영은 별도 서버 구현을 사용한다.

## 검증

- 담당 웹 영역 집중 테스트: **28개 파일, 143개 테스트 통과**.
- 웹 TypeScript 검사 통과.

주 작업에서 App의 핀 필터 연결과 자동 소속 생성 도구를 통합했다. 이후 전체 타입 검사·빌드, 642개 기본 테스트와 실제 DB 3개 테스트가 통과했고, 두 Canvas에서 독립 필터·공유 이름·좌표 변경을 브라우저로 확인했다. 상세 결과는 [완료 기록](2026-10-01-Canvas-UnifiedFiltersCompletion.md)을 참조한다.
- 변경 파일 Prettier 적용 및 검사, 담당 변경 `git diff --check` 통과.
- 신규 회귀 검증: 필터 선택 시 문서 불변, 레거시 링크가 개인 뷰를 만들지 않음, 단일 도메인 생성의 전체 포인터 좌표 유지, 공유 배치 편집과 개인 배치 보존, 관계 양쪽 끝점 필터와 공유 관계선 선택, 공유 메모 핀 좌표와 개인 핀 비표시.
- 실제 두 캔버스 브라우저 QA, App 연동, 서버·실제 DB 통합은 주 작업에서 검증한다. 최종 QA 중 빌드 결과를 교체하지 않도록 별도 dist 빌드는 수행하지 않았다.

## 변경 경로

- `apps/web/src/features/canvas/Canvas.tsx`
- `apps/web/src/features/canvas/Canvas.test.ts`
- `apps/web/src/features/canvas/canvas-view.ts`
- `apps/web/src/features/canvas/canvas-view.test.ts`
- `apps/web/src/features/canvas/translations.ts`
- `apps/web/src/features/domains/domain-view.ts`
- `apps/web/src/features/domains/domain-view.test.ts`
- `apps/web/src/features/comments/CommentsPanel.tsx`
- `apps/web/src/features/comments/comments-state.ts`
- `apps/web/src/features/comments/comments-state.test.ts`
- `apps/web/src/features/relations/prepare-table-relations.test.ts`

사용자 요청에 따라 이 담당 변경은 커밋하지 않았으며, 주 작업에서 정확한 경로를 검토한 후 커밋한다.
