# 단색 버튼 제품 적용 결과

- 승인된 단색 버튼 목업을 제품의 기존 공통 Button에 적용했다.
- 토큰을 중립/주요/선택/위험/비활성으로 정리하고 상단 도구의 별도 그라데이션 덮어쓰기를 제거했다.
- inset outline으로 테두리를 표시해 기존 padding·크기·클릭 영역을 유지한다. 그림자는 제거하고 focus-visible은 별도 2px 외곽선으로 표시한다.
- Button/React Aria 이벤트·로딩·disabled·접근성 API를 변경하지 않았다.
- 댓글 핀은 주요 색상 hover에서도 흰 글자를 유지하도록 보완했다.
- pnpm format 적용, format:check 통과. 기존 ui.test.ts 6개 테스트 통과.
- 실제 Button 격리 화면에서 일반/선택/비활성/로딩 상태, 클릭 0→1, background-image:none 및 box-shadow:none을 확인했다. 편집기 제어 높이 30px가 유지됨을 확인했다.
- 좌측 탐색 분리는 다음 독립 작업 단위로 진행한다.
- [구현 계획](../planning/2026-10-12-UI-ApprovedDesignImplementationPlan.md)
