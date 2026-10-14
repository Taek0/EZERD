# 방문 후 접힌 고급 폼의 표시 경계

- 브라우저 계측에서 한 번 열었다 접은 폼은 옵션 UI 자체가 ACK마다 다시 평가되는 비용이 남아 있었다.
- NativeEditorForm에 renderActive를 추가했다. false인 동안 마지막 커밋된 children 표시 요소를 재사용하며 draft rebase/자동저장/권한/state 처리는 계속 수행한다. 고급 폼에만 연결하며 기본값은 true다.
- 다시 펼치기 전에 preparing 상태로 최신 표시 트리를 생성한 뒤 높이를 측정한다. dirty 상태를 버리거나 snapshot을 고정하지 않는다.
- 닫힌 dirty 인덱스/CHECK의 저장, 닫힌 상태의 ACK 갱신 중 표시 callback 생략, 재열기 갱신 회귀를 검증했다.

[계획](../planning/2026-10-14-Performance-AdvancedAndAckBoundaries.md)
