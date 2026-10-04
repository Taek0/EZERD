# Native 개인 요청 복구의 실제 busy 상태 수정 계획

- 실제 응답 유실/CAS 증가 QA에서 private pending 자체가 root editorBusy에 포함되어, 이를 해제해야 할 proof/release 버튼이 계속 비활성인 문제를 수정한다.
- 일반 편집의 queue 차단은 유지한다. root의 외부 작업·shared saving/pending·storage loading 실패는 recoveryBusy로 전달하고, Canvas는 개인 작업/sending lease가 진행 중이면 복구를 차단한다. unknown/pending 자체만으로 fresh GET proof와 보관 후 명시 local release를 막지 않는다.
- actor/snapshot guard, 실제 lease/exact payload 원자 fence 및 unknown 일반 discard 금지는 유지한다. 실제 root→Canvas 렌더 prop 테스트와 production queue/proof 회귀를 검사하고 같은 브라우저 QA 재현을 다시 실행한다.
