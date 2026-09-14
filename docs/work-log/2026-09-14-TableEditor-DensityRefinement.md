# 테이블 편집 밀도와 도메인 뷰 개선

작성일: 2026-09-14

테이블 카드 제목을 20px, 행을 17px로 확대하고 글자 폭·25px 행 간격을 카드 최소 크기 측정에 반영했다. 컬럼 편집은 컬럼명 전체 폭, ENUM/검색 타입 2열, 숫자 매개변수 3열, 배열/NULL 한 행으로 배치했다. 컬럼 목록의 중복 이름을 제거하고 FK 팝업을 소폭 축소했다.

도메인 뷰 버튼 아래에 공유 UntitledPopover/Dialog 메뉴를 배치했다. 이름·도메인 체크·저장한 뷰 이동·새 뷰·삭제를 제공하며 삭제는 기존 확인 창을 거친다. 새 합성뷰는 상단 관계 경로가 툴바에 가리지 않도록 뷰포트 여백을 둔다. 기존 뷰 변경 시 원본 문서 전체와 표시 노드 ID를 분리해 숨긴 노드를 보존한다.

관계 조절점은 누른 채 드래그하면 저장된 bend x/y를 연속 갱신한다. SVG 화면 변환의 역행렬과 pointer capture를 사용해 확대율과 카드 겹침에 대응하며 방향키 8px/Shift 32px 조절을 지원한다. 핸들은 카드보다 위의 별도 SVG에 표시하고 PNG 내보내기에서 제외한다. 기존 offset도 유지한다.

검증:
- web typecheck 통과.
- TableEditor/Canvas/table-geometry 단위 테스트 20개 통과. 임의 x/y 및 자기 참조에서 모든 경로 선분의 직교성을 확인했다.
- browser-table-feedback-smoke 통과: 20/17px, 688×922 카드에서 내부 가로·세로 넘침 없음, FK 자동 컬럼 생성, 검색 타입, 드래그/방향키.
- browser-density-editor-smoke 통과: 툴바 하단 메뉴 위치, Escape 후 트리거 포커스, 20개 도메인 목록 스크롤, 뷰 생성, 70% 일반뷰 및 100% 합성뷰에서 실제 포인터 이동 x/y를 확대율로 보정한 저장 좌표, 기존 뷰 경로 보존, 컬럼명·VARCHAR/120·NULL·설명 편집 후 새로고침 유지, 삭제 확인 취소.
- 컬럼 편집 실제 측정 263×351px, 내부 가로 넘침 없음. 스크린샷 .cache/verification/density-editor.png 및 density-domain-menu.png.

Browser 플러그인 연결은 Windows sandbox kernel 시작 오류로 실패하여 기존 저장소 Playwright 방식으로 로컬 검증했다. 이 검증의 새로고침 저장은 독립 fixture의 sessionStorage를 사용하며 서버 통합 저장 검증과는 구분된다.

최종 공통 검증: pnpm check 통과(typecheck, 115개 테스트 통과/통합 11개 기본 제외, production build). Vite의 기존 500kB 번들 크기 안내만 남았다. 서버 통합 11개는 주 작업에서 별도 실행했다.
