# 제품 렌더 경계 최종 검증

- 실험 대조 plugin을 모두 끈 제품 profiling 빌드(eeb1228)에서 50개 테이블 × 10개 컬럼, warmup 1회 + 측정 3회를 실행했다.
- React actualDuration 합계 중앙값: 핀 열기 12.2ms, 컬럼 펼치기 23.5ms, 속성 패널 닫기 12.7ms. 이전 기준은 각각 45.0/112.9/31.1ms였다. 서로 다른 실행 시점 비교이므로 정확한 개선율 보장은 아니다.
- 컬럼 펼치기에서 NativeCanvasTableRows 1회, EditableNativeCanvasInlineCell 80회로 확인했다. 이전 기준은 50회/1,550회였다. 모든 측정에서 목표 UI 상태와 문서 fingerprint 불변을 확인했다.
- 최종 검색 닫힘 보완(246f3ab) 후 Chrome에서 검색 col_9의 버튼 50개, 검색 해제 직후 50개 유지, 전환 이후 0개를 확인했다. 일반 테이블 펼침은 10개, 닫힘 후 0개였다.
- 원시 결과: artifacts/performance/2026-10-14-button-product/product-50.json (Git 제외). 저장 요청은 fixture에서 차단되며 이 결과는 FPS/INP/실제 픽셀 표시 시간이 아니다.
- lab 전체 검사 2,902 passed / 499 skipped, 최종 검색 보완 후 집중 회귀 6개 및 타입/profiling build 성공. main 전체 검사 결과는 main의 Git 반영 기록에 별도로 남긴다.
- 기존 애니메이션/검색 동작을 보존하면서 두 확인된 병목을 줄였다. 서버 저장/ACK 지연 개선은 이번 범위에 포함하지 않았다.

[계획](../planning/2026-10-14-Performance-ButtonRenderBoundaries.md)
