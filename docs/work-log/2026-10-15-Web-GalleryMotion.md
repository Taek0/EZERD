# 갤러리 hover 및 중복 모션 정리

- 기존 갤러리의 `translateY(-3px)` 효과를 공통 디자인의 `transform:none`이 덮어쓰고 있었다. 공통 스타일에 180ms transform 전환을 복원하고 현재 그림자/테두리 전환을 유지했다.
- 프로젝트명 수정 중인 카드는 이동하지 않는다. reduced-motion에서는 상승과 전환을 비활성화한다.
- 새 카드 등장 모션의 fill-mode를 both에서 backwards로 바꿔 종료 후 transform을 계속 덮어쓰지 않도록 했다.
- workspace popover는 공통 ui-popover 모션을 이미 상속하므로 중복 정의를 제거했다.
- 항상 마운트된 탐색 패널의 내부 등장 모션은 숨겨진 동안 끝날 수 있어 제거했다. 패널 자체의 열기/닫기 전환은 유지한다.
- 관련 CSS 참조 및 전역 덮어쓰기를 조사했다. 웹 타입 검사 및 관련 프로젝트 회귀 테스트를 통과했다. 브라우저 렌더링을 통한 수동 모션 검증은 수행하지 않았다.

계획: [폰트 캐시 및 갤러리 모션](../planning/2026-10-15-Web-FontCacheAndGalleryMotion.md)
