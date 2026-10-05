# 패널 전환 성능 계측·개선 계획

- 원본 220ms 패널 폭/grid 모션을 유지하고 핀 패널 및 속성 패널의 열림/닫힘을 별도로 계측한다.
- 고정 Native 문서 50/100×10을 전체 NativeProjectView에 연결한다. synthetic GET만 사용하고 API 쓰기는 차단한다. Profiler, 함수 실행 횟수, rAF 간격, panel 실제 너비/모션을 기록한다.
- 원인 후보: 작업 영역 ResizeObserver→상위 state 갱신, 변경되는 callback/context로 scene memo 무효화, 폭 애니메이션 중 layout 및 textarea 측정.
- 먼저 baseline을 기록하고 최신 callback 의미와 저장/권한 가드를 유지하면서 불필요한 scene 재렌더를 분리한다. 필요하면 observer 갱신도 레이아웃 결정에 필요한 범위로 제한한다.
- 개선 전후 같은 조건을 비교하고 열림/닫힘, resize bounds/반응형, 저장 최신성, 원본 모션을 확인한다. 제품 코드와 lab 도구는 별도 커밋한다. main/원격 반영은 별도다.
