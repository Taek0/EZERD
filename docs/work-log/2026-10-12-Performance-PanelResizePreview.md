# 패널 폭 드래그 렌더 분리 구현

- 탐색/핀 패널에서 pointermove는 마지막 폭을 예약하고 rAF당 CSS 변수와 separator ARIA만 갱신한다. React 폭 state는 종료 시 한 번 확정한다.
- pointerup의 마지막 좌표를 반영하고 다른 포인터의 종료를 무시한다. cancel/lost capture는 마지막 폭을 확정하며 unmount는 예약 frame을 정리한다. 탐색 패널 선호 폭 저장과 키보드/reset은 유지한다.
- focused 회귀 10개 통과: preview frame 병합/중복 finish/취소 복원, 탐색 clamp·키보드·저장, 핀 release 좌표·cancel·unmount. 핀 100회 이동 burst에서 onWidthChange 호출 0회, release에서 1회를 확인했다.
- 이 결과는 이벤트 경로 회귀 검증이다. 브라우저 frame/React 시간의 전후 비교는 후속 계측에서 기록한다. 좁은 viewport의 inspector bounds 변경에 따른 부모 observer 갱신은 별도로 남을 수 있다.

[계획](../planning/2026-10-12-Performance-PanelResizeAndColumnToggle.md)
