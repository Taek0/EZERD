# 자동저장 로컬 이름 표시 브라우저 검증

- 50 테이블 합성 fixture의 실제 인라인 input에 DOM 입력 이벤트를 전달했다. 서버는 모의 gate로 ACK를 보류하며 실제 서버 문서는 수정하지 않았다.
- 입력 후 프로젝트 이름 표시가 약 170.4ms에 관찰됐다. 첫 전송은 약 1252ms였고 로컬 표시 시점에는 전송 전이었다. 프로파일링/스케줄링/25ms DOM polling을 포함하므로 INP/픽셀 표시 지표나 전송 시간 보장이 아니다.
- 첫 ACK를 보류한 동안 intermediate_value → local_first_2 입력이 로컬에 표시됐다. 전송 요청은 한 건만 in-flight였고, 기존 요청 본문은 변하지 않았다.
- 첫 ACK 후 두 번째 요청에는 최신 값만 들어갔다. 이전 ACK에 의해 최신 이름이 되돌아가는 DOM 샘플은 없었다. 마지막 실제 컬럼 추가 버튼도 ACK 전 표시, ACK 후 한 행/큐 비움으로 확인했다.
- raw: artifacts/performance/2026-10-14-autosave-local/browser.json. beforeTransmit/beforeAck/onlyFirstInFlight/firstRequestUnchanged/secondContainsLatest/afterEarlierAck/neverReverted/addBeforeAck/addedExactlyOnce/queueEmpty 모두 true.
- 가짜 타이머 회귀는 749ms에는 요청하지 않고 750ms에 최신값 한 번 전송되는지 확인한다. 실제 브라우저 전송은 로컬 처리/저장 claim/스케줄링으로 더 늦을 수 있다.
- 현재 탭 이름 초안의 로컬 표시를 분리한 것이며, 다른 writer 초안 자동 복구나 삭제/관계/타입의 선반영 확대는 하지 않았다.

[계획](../planning/2026-10-14-Performance-AutosaveLocalDrafts.md)
