# 영역 선택 렌더 분리 계획

- 선택 사각형은 전용 DOM ref로 표시하여 이동마다 workspace React state를 갱신하지 않는다.
- 영역 판정은 requestAnimationFrame으로 합치고 동일한 선택 배열은 기존 참조를 반환한다.
- pointerup에서 마지막 좌표를 반영하고 cancel/lost capture/view 변경/unmount에서 예약 작업을 정리한다.
- Shift 추가 선택, 캡처 소유 포인터 구분, 카메라 확대 배율과 표시 스타일을 보존한다.
- 순수 frame scheduler·선택 동등성 테스트 및 캔버스 통합 이벤트 테스트와 전체 검사를 수행한다.
- 테이블 이동의 durable draft 저장 변경은 이번 범위에서 제외한다.
