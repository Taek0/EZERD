# 우측 속성 패널 폭 미리보기 구현 계획

- 기존 CSS Grid 구성과 키보드/clamp 규칙을 유지하고 패널 폭만 CSS 변수로 연결한다.
- 독립 hook에서 rAF 미리보기를 재사용한다. pointermove에서 상위 width state를 바꾸지 않고 종료 시 최종 폭을 저장한다.
- pointerup 최종 좌표, 다른 포인터 무시, cancel/lost capture, unmount 예약 frame 정리, 키보드/clamp를 테스트한다.
- 성능 워크트리에서 구현하고 전체 검사를 진행한다. 로컬 main 반영은 선별 가능한 제품 커밋으로 유지한다.
