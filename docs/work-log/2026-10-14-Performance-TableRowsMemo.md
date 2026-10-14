# 테이블 행 memo 경계 구현

- NativeCanvasTableRows에 React 기본 shallow memo를 적용했다. document/editorContext와 모든 콜백 변경이 비교에 포함된다.
- 기존 함수 본문 이름을 유지해 lab 계측을 계속 사용할 수 있다. 함수 직접 호출 테스트는 memo 내부 구현을 명시적으로 호출하고 기존 렌더 결과/메뉴/편집 검증을 유지한다.
- 제품 수준 렌더 횟수와 후속 전체 검사는 탐색 목록 개선 후 동일 fixture로 확인한다.

[계획](../planning/2026-10-14-Performance-ButtonRenderBoundaries.md)
