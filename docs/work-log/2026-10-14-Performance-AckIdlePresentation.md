# ACK 비편집 셀 표시 경계 축소

- 문서/snapshot/권한은 기존대로 전달하고 hook 상태·latest ref를 갱신한다. 변경이 없는 비편집 셀의 Tooltip/span 표시 요소만 useMemo로 재사용한다.
- 루트 포인터/키보드/IME 이벤트는 useCommittedEvent로 최신 커밋된 handler에 전달한다. 편집 중 subtree는 항상 새로 생성하여 옵션·검증·ACK를 반영한다.
- 타입 옵션은 실제 타입 셀을 편집할 때만 생성한다. 미편집 ACK마다 모든 타입 셀의 policy 목록을 만들지 않는다.
- 집중 회귀 43개 통과. 실제 useMemo 의존성을 보존하는 테스트 driver로 ACK 후 요소 재사용, 최신 저장 기준/콜백, 값 변경, busy 권한 변경을 추가 검증했다.
- 테이블 행/편집 hook의 모든 실행을 없애는 변경이 아니다. 최신 상태 전달과 무관한 표시 subtree 갱신을 분리한다.

[계획](../planning/2026-10-14-Performance-AdvancedAndAckBoundaries.md)
