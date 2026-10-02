# 워크스페이스 선택 UI 프로토타입

- 실제 서비스 변경 없이 `apps/web/workspace-switcher-prototypes.html`에 세 가지 선택 방식을 구현했다.
- A는 로고 옆 이름 드롭다운, B는 왼쪽 고정 전환 바, C는 검색 모달이다. 쿼리 `variant=a/b/c` 또는 상단 버튼으로 비교한다.
- 공통 예시는 Edusync의 klassboard-backend, TY의 ezerd/monya다. 카드 통계와 초대는 예시 데이터이며 실제 API·DB·로컬 저장소를 사용하지 않는다.
- 브라우저에서 각 시안을 렌더링해 개별 JPG를 저장했다. A/B의 TY 전환과 프로젝트 목록 갱신, C의 이름 검색 및 검색 결과 전환을 확인했다.
- HTML의 JavaScript 구문 검사 및 Prettier 검사, git diff 검사를 수행했다.
- 실제 버튼·갤러리·워크스페이스 구현에는 적용하지 않았다. 사용자의 시안 선택 및 세부 정책 결정 후 반영한다.
