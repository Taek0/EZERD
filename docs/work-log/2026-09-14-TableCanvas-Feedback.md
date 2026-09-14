# 테이블 캔버스 피드백 구현 기록

작성일: 2026-09-14

- 테이블 제목 18px, 컬럼 15px로 확대하고 PK/FK에 옅은 하이라이트를 적용했다. 내용 기반 최소 너비·높이 및 행 높이를 공통 `table-geometry.ts`로 계산하여 캔버스 크기 제한·관계선·내보내기와 공유한다. 컬럼 추가 버튼은 왼쪽 아래에 배치해 크기 조절 손잡이와 분리했다.
- 카드 전체 우클릭에서 브라우저 메뉴를 차단하고 컬럼 추가·핀 작성·PK 관계 시작을 제공한다. 사용자 노출 용어에서 물리/물리명을 제거했다.
- 공개 Untitled UI Combobox 원본(c981a73bcd6b6c68d2a54070f20f020191212828)의 Group/Input/Popover/ListBox 구성을 공통 스타일 및 항목 컴포넌트로 적용했다. 타입 검색과 대문자 표시를 지원하고 저장 타입명은 기존 규칙을 보존한다.
- PK에서 관계를 시작하며 도착 테이블에 자동 생성될 FK 컬럼을 대화상자에서 미리 보여준다. 모델의 원자적 생성 API를 사용해 복합 PK 순서·타입과 이름 충돌 규칙을 유지한다.
- 관계선은 직각 선분만 사용하고 라벨은 PK테이블.PK컬럼:FK테이블만 표시한다. 선 조절 버튼이 보기별 경로 오프셋을 저장한다. 함께 보기에서는 양쪽 소유 도메인이 선택 집합에 속하는 관계만 표시한다.
- 테이블 삭제 확인은 공통 ConfirmProvider를 사용한다.

## 검증
- `pnpm --filter @ezerd/web typecheck` 통과.
- `pnpm exec vitest run apps/web/src/TableEditor.test.ts apps/web/src/table-geometry.test.ts`: 14개 통과.
- `scripts/browser-table-feedback-smoke.mjs`: 격리된 실제 Chrome에서 PK→FK 자동 컬럼, 하이라이트, 정확한 라벨, 직각 경로와 저장 오프셋(32), 헤더 우클릭 컬럼 추가, 검색 VARCHAR 선택 및 canonical varchar 저장 통과. 제목 18px/컬럼 15px 확인.
- 긴 한글 설명을 포함한 9개 컬럼 카드: 688×665px. 컬럼 영역 scrollWidth=clientWidth=688, scrollHeight=clientHeight=561로 내부 스크롤 없음.
- 스크린샷: `.cache/verification/table-feedback.png`. 이미지 열기 도구가 Windows sandbox 초기화 오류로 실패하여 이미지를 직접 육안 확인하지 못했다. DOM 크기·글꼴·동작 검증은 완료했다.
- 도구 기본 샌드박스가 실행 전 초기화 실패하여 승인된 workspace 작업을 require_escalated 셸로 실행했다. 브라우저 Node 런타임도 같은 초기화 오류가 있어 격리된 Playwright Chrome으로 검증했다.

## ENUM 이름 변경 후 크기 계산 보완
- ENUM의 현재 이름을 대문자 및 배열 접미사까지 포함한 표시 문자열로 한 번 계산하고, 열 너비와 행 높이에 동일하게 사용한다. 컬럼에 남아 있는 이전 타입 이름 때문에 긴 ENUM 이름이 잘리는 문제를 수정했다.
- 이전 타입 이름을 유지한 상태에서 ENUM을 긴 이름으로 변경하면 최소 높이가 늘어나고 최신 타입 이름을 가진 경우와 같은 크기가 계산되는 회귀 테스트를 추가했다.
- `pnpm exec vitest run apps/web/src/table-geometry.test.ts`: 4개 통과.
