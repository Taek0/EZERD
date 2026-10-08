# Draft 구독 알림 microtask 처리 계획

이 문서는 구현·검증 후 사용자의 요청으로 보완한 계획 기록이다. 작업 시작 시 합의한 범위와 보존 조건을 정리한다.

## 문제와 목표

컴포넌트의 useState 초기화에서 loadNativeDraft 또는 loadNativeEditorDraft를 호출하면 retain/forgetNativeMemoryDraft가 실행된다. 기존 notify는 구독자를 동기로 호출하므로 부모 useSyncExternalStore 갱신이 자식 렌더 도중 발생할 수 있다.

상태와 영속 보관은 즉시 갱신하되 UI 구독 알림만 microtask로 합쳐 렌더 중 갱신과 중복 알림을 방지한다.

## 변경 범위와 보존 조건

- native-durable-drafts.ts와 native-export-state.ts의 구독 알림 경로만 변경한다.
- 메모리·export 저장소가 공유하는 구독 콜백은 같은 배치에서 한 번 호출한다.
- 원문 draft, dirty, 보관 실패, forget/clear 및 ACK 관련 처리는 동기 의미를 유지한다.
- export·네비게이션 guard는 알림 전달 전에도 최신 상태를 읽는다.
- flush 전·도중 해제한 구독은 호출하지 않는다. flush 중 변경은 다음 microtask로 전달한다.
- 이전 고급 UI와 후속 회귀 두 파일은 freeze 상태를 유지한다. Git add/commit은 오너가 담당한다.

## 검증

전용 회귀 테스트로 두 loader의 React useState 초기화 경로, 중복 알림, unsubscribe, flush 중 새 dirty, 즉시 guard를 확인한다. 관련 export·durable 테스트를 실행하고 광범위 검증은 오너의 final check에 통합한다. 브라우저 실제 경고 재검증 중에는 제품 소스를 수정하지 않는다.

결과: [구현 및 검증 기록](../work-log/2026-10-08-DraftNotification-MicrotaskResult.md)
