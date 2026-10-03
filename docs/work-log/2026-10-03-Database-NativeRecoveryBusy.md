# Native 개인 요청 복구 busy 상태 수정 결과

- [계획](../planning/2026-10-03-Database-NativeRecoveryBusy.md), [실제 실패 재현](2026-10-03-Database-NativePrivateCASBrowserQA.md). private unknown/pending 자체가 root의 editorBusy에 포함되어, 이를 해제해야 할 proof/release UI까지 잠기는 결함을 수정했다.
- root는 실제 외부 작업/shared saving/shared pending/저장소 초기 확인을 recoveryBusy로 전달한다. 일반 편집은 기존대로 queueBlocked까지 포함해 차단한다. Canvas recovery는 개인 작업 또는 sending lease 중에도 차단한다. 모르는 상태에서 원문/요청을 자동 제거하지 않는다.
- root→Canvas의 실제 렌더 wiring을 unknown/pending/sending·외부 busy·초기 loading·shared saving·empty 상태로 검사했다. production queue/proof/Canvas 포함76개 통과, 웹 타입/production build 통과. actor/current scope guard·정확한 payload/owner/token/lease atomic fence와 일반 unknown discard 차단은 유지했다.
- 최신 bundle으로 실제 response-loss/CAS 증가 fixture의 fresh GET→archive→명시 release 브라우저 재검증을 이어간다. 이전 비활성 상태 재현을 성공으로 계산하지 않는다.
