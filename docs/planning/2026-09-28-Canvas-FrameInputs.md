# 드래그·카메라 입력의 프레임 단위 반영

작성일: 2026-09-28
기준: `735f60a`, `feat/performance-measurement`.

- latest-only frame queue로 단일/다중 카드 이동·resize의 문서 preview와 카메라 갱신을 묶는다. 연결 미리보기·marquee·관계선 조절은 이번 범위에서 제외한다.
- wheel은 입력을 버리지 않고 pending 카메라에 순서대로 누적한다. pointer 이동은 시작 위치 기준 마지막 절대 좌표만 적용한다.
- pointerup/cancel/lost capture/blur/hidden은 마지막 예약 입력을 flush하고 commit한다. 기존 pointercancel의 마지막 위치 확정 의미를 유지한다. 명시적 뷰 이동은 먼저 gesture를 종료하고, 외부 뷰/권한 변경 및 unmount는 오래된 예약을 취소한다.
- preview는 최신 문서 ref를 즉시 갱신해 React render 전 종료되어도 마지막 입력을 commit할 수 있게 한다. 새 문서가 들어오면 예약 patch는 최신 문서에 적용한다.
- fake frame 테스트로120개 입력→1회 적용, wheel 순서·최종값, 종료 flush·cancel·재진입을 검증한다. 실제 브라우저 MOVE/PAN/EDIT도 전후 문서·경로가 같아야 한다.
- 실제 도구 drag는 이벤트를 프레임마다 나눠 전달할 수 있으므로 항상 계산 수가 줄어든다고 가정하지 않는다. 입력 폭주 검증과 실제 브라우저 결과를 구분한다.
