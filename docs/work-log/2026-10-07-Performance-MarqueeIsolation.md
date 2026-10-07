# 영역 선택 렌더 분리 결과

## 구현

- main 3623b0b 기반 성능 lab에서 선택 사각형의 위치/크기를 전용 DOM ref로 갱신한다. 기존 CSS·카메라 transform·확대 배율별 테두리·export 제외 속성은 유지한다.
- pointermove는 최신 좌표만 예약하고 requestAnimationFrame에서 한 번 계산한다. 선택 결과가 같으면 state setter를 호출하지 않아 scene에 전달하는 배열 참조를 유지한다.
- pointerup 좌표는 동기 flush로 반영한다. 취소·캡처 소실·Escape·뷰 전환·unmount 시 남은 frame을 취소한다. 다른 포인터의 캡처 소실은 진행 중인 영역 선택을 중단하지 않는다.
- 테이블 이동의 durable draft 저장 경로는 변경하지 않았다. 별도 main 작업의 미커밋 파일은 수정하거나 포함하지 않았다.

## 검증

- 신규 회귀 테스트 9개: 동일 선택 120회 이동의 배열 참조 유지, 120회 burst의 예약 frame 1개, 프레임 전 release의 최종 좌표 반영, Shift 합집합, cancel/lost capture, view 전환/unmount 정리, scheduler 재사용 및 선택 동등성.
- `pnpm format`, `pnpm check` 통과: 225개 파일 / 2,780개 테스트 통과, 27개 파일 / 502개 환경 조건부 skip. 전체 타입·서버/웹 빌드 통과. 기존 bundle 크기 경고 유지.
- localhost:4180의 쓰기 차단된 전체 편집기 fixture에서 50개 테이블·10컬럼으로 실제 브라우저 드래그를 확인했다. 100% 및 83% 배율 역방향 선택에서 table_0 선택과 release 후 사각형 숨김 확인. 축소 후 테두리는 1.2px로 적용되어 화면상 두께를 유지했다.
- 최초 브라우저 동작 검증에는 console error가 없었다. 코드 저장에 따른 lab의 HMR 후 createRoot 중복 경고가 관찰됐다. fixture 개발 서버의 재초기화 경고이며, 제품 production build는 정상 완료했다.
- 브라우저 드래그 프레임 시간의 전후 비교는 아직 수행하지 않았다. 테스트의 배열 참조 유지와 이벤트 합치기를 FPS 개선율로 해석하지 않는다. 대량 객체가 실제로 선택/해제될 때의 scene 렌더·paint 비용은 남는다.

## 다음 범위

제품 전용 PR 선별 및 production fixture 전후 프레임 계측. 이후 테이블 자체 이동의 미리보기·durable draft 저장 빈도 분리를 별도 설계한다. 현재 변경은 codex/performance-lab에 커밋하며 main 반영·원격 push는 수행하지 않는다.

[계획](../planning/2026-10-07-Performance-MarqueeIsolation.md) · [원인 검증](2026-10-07-Performance-DragDiagnosis.md)
