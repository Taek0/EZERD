# 컬럼 선택에 따른 테이블 카드 갱신 범위 축소

- 컬럼 상세 열기/닫기 시 NativeCanvasScene이 선택 컬럼의 소유 테이블을 조회하고 해당 카드에만 selectedColumnId를 전달한다.
- 다른 테이블의 NativeCanvasTableRows props는 동일하게 유지되어 React.memo가 렌더를 생략할 수 있다. 기존 상세 패널 높이/불투명도 애니메이션은 유지한다.
- NativeCanvasScene 회귀 테스트 19개 통과. 관련 없는 카드의 모든 props가 Object.is 기준으로 같고 선택 해제도 반영되는지 검증했다.
- 브라우저 시간 수치는 후속 계측에서 확인한다.

[계획](../planning/2026-10-12-Performance-PanelResizeAndColumnToggle.md)
