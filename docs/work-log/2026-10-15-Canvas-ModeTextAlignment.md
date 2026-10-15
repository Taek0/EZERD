# 설계 모드 수직 정렬 수정

- 원인은 responsive-shell의 높은 우선순위 버튼 스타일이었다. 내부 높이 26px인 세그먼트에 min-height:32px와 상하 padding:4px, line-height:1.4가 적용돼 버튼 중심이 그룹보다 3px 아래로 내려갔다.
- native-main-integration.css에서 해당 설계 모드 버튼에만 더 구체적인 선택자를 사용하고 min-height:0을 지정했다. 의도한 12px 글꼴·줄높이, 상하 padding:0 및 선택/포커스 상태가 적용되도록 했다.
- 이전 flex 정렬만으로는 공통 스타일의 높이 덮어쓰기를 해결하지 못했다. 이번에는 실제 App 의존성과 전체 전역 CSS를 로드한 독립 React 페이지에서 브라우저 치수를 확인했다.
- 수정 전: 버튼 높이 32px, 그룹 대비 중심 +3px, 텍스트 Range 중심 +2.59px. 수정 후: 버튼 높이 26px, 버튼·텍스트 중심 오차 모두 0px.
- 1440/1512/1024/680px 너비, 한·영 표시, DPR 1 및 1512px에서 DPR 2 조합을 검증했다. 이는 Chromium 화면 에뮬레이션이며 실제 macOS 폰트 렌더러 검증은 아니다.
- 스크린샷 확인, 변경 CSS Prettier, diff 검사, Vite 빌드 통과. 기존 번들 크기 경고는 남아 있다. 임시 페이지·브라우저·서버는 정리했다.
- DB 변경·마이그레이션은 없다.

계획: [ModeTextAlignment](../planning/2026-10-15-Canvas-ModeTextAlignment.md)
