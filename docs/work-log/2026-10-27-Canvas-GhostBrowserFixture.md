# Ghost drag 브라우저 QA fixture

- `apps/web/performance/ghost-drag.html`은 실제 `NativeERDCanvas`를 합성 10개 테이블로 실행한다. 전용 origin은 `http://127.0.0.1:4184`이며 다른 origin에서는 실행을 거부한다.
- actor와 project ID는 새로 생성하며 `/api` 요청은 모두 fixture 내부에서 403으로 종료한다. 실제 데이터와 저장 서버를 사용하지 않는다.
- 배치 저장 명령 `update_node_layout`, `add_table_reference`만 메모리에 반영한다. 문서는 즉시 갱신하고 snapshot 및 저장 Promise의 ACK는 `ACK 반영` 버튼까지 보류한다.
- `Worker 결과 지연`은 `name: native-ghost` worker만 대상으로 실제 연산 완료 메시지 전달을 1초 지연한다. 다른 worker 및 실제 routing 연산은 변경하지 않는다.
- `문서 변경`은 대기 중 문서를 바꿔 stale/cancel 동작을 확인하며, `초기화`는 미완료 저장을 실패로 마무리하고 새 project로 다시 시작한다.
- DOM에 saveCount, pending, selected, 현재 모든 node 좌표를 노출한다. `현재 좌표` 상세를 열어 확인할 수 있다.
- fixture 3개 파일은 저장소 Prettier로 포맷했다. web TypeScript 검사에서 fixture 오류는 없으며, 병렬 구현 중인 `NativeERDCanvas.ghost.test.ts`의 union 접근 오류가 남아 전체 검사는 통합 단계에서 다시 수행한다.
- production 성능 빌드와 실제 브라우저 입력 검증은 상위 작업에서 수행한다. 이 작업에서는 서버를 실행하지 않았다.
