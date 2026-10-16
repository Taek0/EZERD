# 드래그 선택 영역 복원

- 선택 영역은 524e8ac(v1 캔버스 정리)에서 공용 `.canvas-selection-box` CSS가 제거됐지만 native JSX가 같은 클래스를 계속 사용해 보이지 않았다. 좌표/hidden만 검증하던 기존 테스트는 스타일 누락을 탐지하지 못했다.
- native world 내부로 한정해 absolute 위치·테두리·반투명 배경·z-index·pointer-events:none 및 hidden 처리를 복원했다. 포인터 처리와 프레임 단위 갱신 방식은 바꾸지 않았다.
- jsdom에서 실제 드래그 핸들러의 치수와 계산 스타일을 검증했다. 독립 Chromium에서도 90×80px 선택 영역이 보이고 release 후 사라짐을 확인했다.
- 선택 영역·캔버스 수명주기와 집계 관련 74개 테스트 및 전체 회귀 검사 통과.

계획: [HistoryAndSelectionFixes](../planning/2026-10-16-Canvas-HistoryAndSelectionFixes.md)
