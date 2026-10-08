# ACK 이후 캔버스 미리보기 보존 계획

- QA-03: 원본 DB에는 테이블이 있지만 컬럼 수정 ACK 이후 카드와 목록에서 누락된다.
- 서버 reader는 normalizeSharedTableCanvas로 누락된 공유 배치를 생성하지만 nativeEntryAfterAck는 원본 ACK 문서를 화면에 직접 적용한다. 이 차이를 sparse 원본/정규화된 초기 조회/컬럼 수정 ACK 회귀로 먼저 재현한다.
- 수정 범위는 native-ack-entry.ts 및 해당 테스트다. snapshot.sourceDocument는 ACK 원문 구조를 유지한다. snapshot.native.document와 entry.document에만 서버 reader의 동일한 결정적 ID 규칙으로 정규화한 미리보기를 사용한다.
- 개인 상태는 정규화된 공유 미리보기에 reconcile/merge한다. 기존 명시적 배치, 긴 table ID 및 ID 충돌 규칙, 원본 불변을 검증한다.
- GET 재조회 우회, 원본 보정 저장, 기존 ACK 연속성/권한 검증 완화는 하지 않는다. 대상만 포맷하고 Git add/commit 하지 않는다.
