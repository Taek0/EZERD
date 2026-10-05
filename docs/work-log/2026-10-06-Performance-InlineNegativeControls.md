# 인라인 hook / Tooltip 분리 대조

- 532cccf clean production profiling build, 100×10, 1280×520, 조건별 워밍업+3회, 120프레임.
- full 편집 UI, 셀 Tooltip 제거, 편집 hook을 정적 동일 class span으로 대체, 그림자/필터 제거 조건의 본 측정 p95 중앙값이 모두 약 40ms였다. 편집 hook과 Tooltip 제거만으로 지연을 해소하지 못했다.
- NativeCanvasWorkspace 120회가 실행되나 NativeCanvasTableRows 및 EditableNativeCanvasInlineCell은 이동 중 0회였다. LoAF/longtask 관측은 0개였다. 프레임 지연 전체를 React/JS 또는 paint로 단정하지 않는다.
- 후속으로 world 합성 힌트, 셀 clipping, 화면 밖 content-visibility를 분리한다. 제품 코드/모션은 변경하지 않는다.
