# 패널 입력 비교 계측

- panels.html에 탐색/핀 폭 왕복(60프레임, 프레임당 pointermove 4회)과 컬럼 열기/닫기(각 30프레임) 시나리오를 추가했다. 1회 warmup + 3회 측정한다.
- React profiling 빌드에서 commit 횟수/시간, rAF 간격, 최종 ARIA 상태, 문서 fingerprint를 기록한다. 합성 포인터 capture shim은 대상 separator에만 임시 적용하고 복원한다.
- EZERD_PANEL_INTERACTIONS=1로 profiling을 켜고, EZERD_PANEL_INTERACTION_BASELINE=1로 제품 파일 4개만 f9853fa 버전으로 교체한다. 계측 도구와 fixture는 동일하다.
- 실제 입력 지연/GPU 시간을 직접 측정하는 도구는 아니다. raw 결과는 artifacts/performance에 보관한다.

[계획](../planning/2026-10-12-Performance-PanelResizeAndColumnToggle.md)
