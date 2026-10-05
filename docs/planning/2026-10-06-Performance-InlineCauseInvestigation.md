# Native 인라인 편집 이동 지연 원인 조사

- 최신 main과 동일한 lab 제품 코드를 유지한다. 측정 전용 transform/CSS만 변경한다.
- 100개 테이블 × 10컬럼, 1280×520 캔버스, 조건별 워밍업+3회, 순서 교차로 비교한다.
- 조건: 실제 편집 UI / 셀 Tooltip 제거 / 편집 hook을 정적 span으로 대체 / 카드·셀 shadow 등 시각 효과 제거. 모션을 제품에서 제거하지 않는다.
- NativeCanvasWorkspace/EditableNativeCanvasInlineCell/NativeCanvasTableRows를 추가 계측해 이동 중 실제 실행 경로를 확인한다. LoAF의 script/forced style-layout 관측도 확인한다.
- 유효 표본의 문서 불변·카메라 왕복·build clean을 검사한다. 단일 조건만으로 paint/GPU 또는 Tooltip을 원인으로 확정하지 않는다. 결과와 다음 개선 범위를 work-log에 남긴다.
