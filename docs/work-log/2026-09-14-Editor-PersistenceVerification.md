# 편집 기능 실제 앱 지속성 검증

작성일: 2026-09-14

## 검증 범위
- 실제 Vite 앱과 Nest API, PostgreSQL을 사용한다. 테스트 전용 사용자와 프로젝트를 만들고 종료 시 해당 ID만 제거한다.
- 프로젝트 열기, 테이블 셀 더블클릭, Enter/Tab 확정, 저장과 브라우저 새로고침을 검증한다.
- ENUM ID 참조와 값 정의, 관계 양 끝 선택성 및 설명이 저장·재로딩 후 동일함을 확인한다.
- 테이블 뷰의 빈 캔버스 우클릭 자동 배치 후 현재 뷰만 달라지고 외부 테이블의 소유 도메인과 다른 뷰 배치가 그대로임을 확인한다.
- 390×844에서 페이지 전체 가로 넘침이 없고 JavaScript 런타임 오류가 없음을 확인한다.

## 발견과 결과
- 첫 실행에서 카드 더블클릭이 입력창을 열지 못하는 실제 Canvas 이벤트 충돌을 발견했다. Canvas 포인터 캡처가 셀 더블클릭을 가로채던 문제를 UI 담당에게 전달했다.
- UI 담당이 셀의 pointerDown 전파를 차단한 후 전체 스크립트가 통과했다.
- 검증 명령: `node scripts/browser-editor-persistence-smoke.mjs` (`EZERD_PLAYWRIGHT_MODULE`에 설치된 Playwright 모듈 경로 지정).
- 스크린샷: `.cache/verification/editor-persistence-desktop.png`, `.cache/verification/editor-persistence-mobile.png`.
- 메모: 카드 내부 스크롤은 허용하며 모바일 검증은 페이지 외부 넘침 범위다.
