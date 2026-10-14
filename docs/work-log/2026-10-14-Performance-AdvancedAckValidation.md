# 고급 편집기·ACK 표시 경계 최종 계측

- 서버 쓰기 없는 50 테이블 × 10 컬럼 ACK 재생, 실제 App과 같은 startTransition 반영, warmup 1회 + 3회 측정. 새 이름 DOM 반영을 모두 확인했다.
- 이전 React actualDuration 합계 724.5~894.1ms 대비, 최초 미사용 고급 폼 조건은 70.5~75.3ms(중앙값 73.4ms), 한 번 열었다 접은 최종 구현은 79.8~83.7ms(중앙값 83.2ms)였다.
- 미사용 고급 폼 subtree는 약 0.1ms, 방문 후 접힌 고급 폼은 약 1.2~1.6ms. 기존 약 558~729ms의 숨겨진 폼 평가/UI 갱신이 제거됐다.
- 캔버스는 미사용 조건 약 39~51ms, 방문 후 조건 약 51~54ms. 비편집 표시 subtree를 재사용하고 타입 옵션 평가를 실제 타입 편집으로 제한했다. 문서/권한/ACK hook 갱신은 유지하므로 행/셀 함수 실행을 모두 제거한 것은 아니다.
- Chrome에서 첫 펼침(폼 1개, 최종 높이 1277px), 닫힘(폼 1개 유지, 높이 41px), 재사용 후 ACK 반영, 인라인 편집 진입 textbox 1개 → Escape 취소 0개를 확인했다. 실제 사용자 문서는 변경하지 않았다.
- 회귀는 최신 저장 기준/콜백/권한 갱신, 접힌 dirty 초안 자동저장, 복구/IME/수정 중 ACK 등을 포함한다. 제품 main의 최종 전체 검사 결과는 main 반영 기록에 남긴다.
- raw: artifacts/performance/2026-10-14-advanced-ack-fix/closed-unused-50.json 및 closed-visited-50.json. 첫 자료는 ca51e9f, 방문 후 최종 자료는 63460b3. visited-before-preserve.json은 숨겨진 옵션 UI 추가 보완 전 자료다.
- React 작업량 비교이며 FPS/INP/픽셀 표시 완료 시간은 아니다. 서버 SQL·전체 문서 ACK 왕복 비용과 일반 자동저장 대기 750ms는 이번 변경 대상이 아니다.

[계획](../planning/2026-10-14-Performance-AdvancedAndAckBoundaries.md)
