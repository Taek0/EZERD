# 탐색·도구 그룹과 사이드바 개선

- 갤러리 버튼과 프로젝트/도메인 경로 사이에 구분선을 추가하고 경로 글자 크기를 13px로 통일했다.
- A안에 따라 이동, 편집, 보기/내보내기, 협업/속성 패널, 변경 기록 그룹을 구분했다. 좁은 화면에서는 기존 반응형 줄바꿈을 유지한다.
- 도메인 뷰 구성 버튼을 테이블 캔버스에서만 제공한다.
- 브랜드 및 갤러리 버튼의 공통 leave 함수에서 기존 ConfirmProvider로 이동 확인을 받는다. 취소하면 프로젝트를 유지하고, 확인하면 기존 자동 저장 flush 이후 종료 순서를 유지한다.
- workspace의 grid 행을 minmax(0, 1fr)로 제한하고 inspector-shell/inspector를 flex로 연결했다. inspector 전체가 스크롤하므로 작은 높이에서도 헤더 아래의 마지막 내용에 접근할 수 있다. 중첩 inspector-body 스크롤은 제거했다.
- 핀치 확대 계수를 0.002로 높였으며 포인터 기준 확대와 기존 제한을 유지했다.

검증: pnpm format 실행, 웹 typecheck 통과, Canvas/canvas-wheel 테스트 2개 파일 8개 통과, git diff --check 통과. pnpm exec의 vitest 실행 파일 연결이 없어 설치된 vitest CLI를 node로 직접 실행했다. pnpm format:check에서 이 작업 파일은 통과했고 병행 작업 중인 MCP controller/service/panel/use-panel-dismiss 4개 파일만 포맷 경고를 표시했다. 실제 화면 검증과 전체 통합 검증은 상위 작업에서 수행한다.
