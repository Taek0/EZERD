# Native 불명확한 요청의 서버 취소 확정 계획

- 로컬 queue 삭제나 HTTP 실패+ledger 404만으로 전송된 요청이 영구 미적용이라고 판단하지 않는다. 명시 사용자 취소는 서버의 기존 ledger/잠긴 project 행으로 확정한다.
- read 권한이 남은 같은 actor의 이미 기록된 요청은 actor/fingerprint 일치 시 원문 ACK를 그대로 반환한다. 미기록 요청은 같은 operation ID·fingerprint의 rejected cancellation ACK를 별도 `native_request_cancellations`에 원자 기록하여 늦게 도착한 동일 요청도 rejected 응답만 재생하게 한다. 다른 actor/다른 요청 ID 재사용은 금지한다. marker는 project 수명 동안 유지하며 project 삭제 때 함께 제거한다.
- 취소는 공유 설계와 project version/sequence·baseline·field version·tombstone을 바꾸지 않는다. 아직 v1인 프로젝트의 업그레이드 요청 취소가 v1 stream에 v2 event를 섞지 않도록 일반 sync ledger와 분리한다. 위조된 baseline·previous·document를 쓰기 권한으로 사용하지 않으며 취소 ACK의 nextBaseline은 새 쓰기 authority로 발급하지 않는다.
- native protocol operation, native command, native upgrade, history undo/restore의 기존 fingerprint와 정확히 일치해야 한다. native sync/upgrade/history의 기존 immutable ledger를 먼저 읽고 cancellation marker를 조회한 뒤 fresh 쓰기를 검사한다. history cancellation은 전용 source/command metadata를 유지한다. 기존 v1 도구의 계약은 변경하지 않는다.
- 웹 IDB pending의 동일 payload 송신 lease 아래에서 취소한다. accepted 기존 ACK는 대응하는 입력만 소비하고 rejected 취소 ACK는 pending만 해제하여 입력을 보존한다. 기존 역할/보관 변화 후에도 자신의 미확인 요청을 정리할 수 있다.
- 실제 취소→늦은 요청, 기존 accepted→취소, concurrent 동일 요청/취소, 권한·fingerprint·snapshot/sequence/이벤트 불변·rollback·v1 upgrade 취소를 격리 DB로 검증한다.
