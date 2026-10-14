# 삭제 ACK 중 동일 화면 참조 유지

- 실제 문서 복제본에서 로컬 삭제 98ms 이후 ACK 해제부터 저장 확인 표시까지 344ms가 관찰됐다. 이 구간 React 합산 184ms, nativeEntryAfterAck 16ms, scene 계산 5회였다.
- NativeProjectView의 표시/공유 투영 결과를 이전 결과와 구조 공유한다. ACK로 확인된 원본 snapshot은 계속 갱신하며, 화면 데이터가 같을 때만 이전 참조를 유지한다.
- 후보 계측에서 scene 계산은 5→1회, React 합산은 184→159ms였다. 저장 확인 340ms로 전체 지연 개선은 아직 작아 영속 큐의 후처리를 추가 조사한다.
- 로컬 삭제→accepted bridge→canonical ACK에서 화면 참조 유지, sequence/version 전진, 이후 서버 값 변경 반영, 원본 요청 불변을 포함한 22개 집중 테스트 통과.
