# 물리·논리 전환 목업 3안

- 독립 HTML `apps/web/design-mode-proposals.html`에 A 소프트 세그먼트, B 아웃라인 세그먼트, C 컴팩트 탭을 제작했다.
- 실제 상단바 비율인 32px 높이·12px 글꼴과 현재 제품 색상 토큰을 사용했다. 모드 버튼 클릭 및 방향키/Home/End, 선택 상태 접근성, reduced-motion을 지원한다.
- 헤드리스 Chromium으로 1200×1000 렌더링하여 `artifacts/design-mode-proposals/comparison.png`를 확인했다. 프로젝트 데이터/API와 무관한 예시 화면이다.
- 로컬 미리보기: `http://127.0.0.1:5188/design-mode-proposals.html` (독립 Vite 서버).
- HTML JS 문법과 Prettier를 확인했다. 실제 앱의 툴바, 기본 모드, 생성 팝업은 변경하지 않았다. 사용자의 디자인 선택 후 구현한다.

계획: [DesignModeMockups](../planning/2026-10-15-Canvas-DesignModeMockups.md)
