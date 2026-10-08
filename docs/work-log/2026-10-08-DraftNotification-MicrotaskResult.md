# Draft 구독 알림 microtask 처리 결과

계획: [범위와 보존 조건](../planning/2026-10-08-DraftNotification-MicrotaskPlan.md)

## 구현

- native-durable-drafts.ts에 공통 microtask 알림 배치를 추가했다. 대기 중인 구독 집합을 모으고 동일 콜백은 한 번만 호출한다.
- native-export-state.ts의 notify도 같은 배치를 사용한다. 실제 상태 변경 및 동기 조회 함수는 변경하지 않았다.
- flush 시작 시 대기 집합을 분리하므로 알림 중 발생한 변경은 다음 microtask에 전달된다. 호출 직전에 현재 구독 여부를 확인한다.
- retain/forget, 원문 복제·보관, forget 구독을 통한 export blocker clear, ACK 및 네비게이션 guard의 동기 의미는 유지한다.

## 변경 파일

- apps/web/src/features/projects/native-durable-drafts.ts
- apps/web/src/features/projects/native-export-state.ts
- apps/web/src/features/projects/native-draft-notification.test.ts

이전 고급 UI 및 후속 회귀 파일은 변경하지 않았다. Git add/commit은 실행하지 않았다.

## 검증 결과

- 전용 notification 회귀 9개: memory/export 중복 합치기, flush 전·중 unsubscribe, flush 중 새 dirty/구독, 동기 clear 후 새 draft, 즉시 export·네비게이션 guard, 두 loader의 useState 초기화, 보관 실패 즉시 조회를 검증했다.
- 앞선 관련 7파일 111테스트가 통과했다. 대상은 notification, export-state, editor-draft, durable-queue, save, draft-archive, versioned-export였다.
- 마무리 검증은 notification/export-state/durable-queue의 targeted 3파일 47테스트가 모두 통과했다. 광범위 테스트는 오너 final check에서 수행한다.
- 변경 소스·테스트 3파일 Prettier 및 diff 검사가 통과했다.
- web 타입 검사는 담당 3파일 오류 0건이었다. 전체 검사는 다른 파일의 오류로 exit 2였으며 진단 출력은 571줄이었다.
- React SSR의 실제 useState 초기화와 실제 저장소 구독 경로를 검사했다. useSyncExternalStore는 구독 함수를 포착하는 테스트 대역이므로 브라우저의 실제 React 경고 소멸을 직접 증명하는 테스트는 아니다. 브라우저 최종 재검증은 QA 담당이다.

## 실행 환경과 인계

지정 Node 24.18.1로 설치된 Vitest CLI를 직접 실행했다. TEMP/TMP는 기존 node_modules/.cache/advanced-ux-temp를 사용했다. 제품 소스는 freeze 상태이며, 본 기록 보완은 문서만 변경한다. 오너에게 수정·검증 결과와 QA 재검증 필요성을 전달했다.
