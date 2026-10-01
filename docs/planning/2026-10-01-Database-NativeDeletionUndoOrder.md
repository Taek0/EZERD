# Native 삭제 역연산의 컬렉션 순서 보존

- 시작 `69b8e53`. native 삭제 planner 테스트 도중 기존 diff/inverse가 삭제 엔티티를 뒤에 append해 컬럼·키 순서를 복원하지 못하는 것을 발견했다. 삭제 planner 변경은 아직 미커밋이며 이 수정과 섞지 않는다.
- native v2 diff에서 삭제할 객체의 이전 위치를 ID move 변경으로 기록한다. forward에서는 move를 모두 수행한 후 엔티티 삭제, inverse에서는 모든 엔티티 복원 후 원래 순서대로 move를 적용한다. 삭제 대상끼리 앵커가 이어진 경우도 처리한다.
- v1 diff/result/fingerprint는 그대로 유지한다. 과거 브라우저의 미전송 v1 요청을 새 변경 목록과 불일치로 거부하지 않는다.
- 여러 삭제/일부 삭제/삭제+재정렬/ID escaping/다른 테이블의 컬럼을 포함한 원상 복원과 v1 회귀를 확인한다. native 서버 undo/restore의 ID 재매핑 소비는 이후 서버 연결 단위에 남긴다.
