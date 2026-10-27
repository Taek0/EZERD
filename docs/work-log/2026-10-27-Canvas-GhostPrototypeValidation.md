# 고스트 드래그 프로토타입 기능 검증

- 계획: [Canvas Ghost Drag 검증 계획](../planning/2026-10-27-Canvas-GhostDragValidationPlan.md)
- 범위: `apps/web/src/shared/performance/ghost-drag-prototype.ts`와 jsdom 테스트만 추가했다. `NativeERDCanvas`와 제품 진입점에는 연결하지 않았다.
- Apple design 지침 중 포인터의 직접 추적과 잡은 위치 보존을 적용했다. 관성, 스프링, GPU 레이어 승격은 도입하지 않았다.

## 확인한 동작

2026-10-27 `pnpm.cmd exec vitest run apps/web/src/shared/performance/ghost-drag-prototype.test.ts`: **13개 통과**. `pnpm.cmd --filter @ezerd/web typecheck`도 통과했다. 줌 0.1의 부동소수점 변환에서 250이 249.99999999999997로 계산되는 차이를 확인하여 좌표는 소수점 10자리 근접 비교로 검증한다.

측정된 월드 노드 좌표를 복사해 시작점을 보존하고, 고정된 월드→클라이언트 원점과 줌으로 포인터를 변환한다. 줌 0.1/0.15/0.25/1/2/4에서 잡은 위치 오프셋, 이동 좌표, 최종 release sample을 확인했다. 117회의 이동 입력은 한 RAF로 합쳐지고 그 전에는 transform 콜백이 실행되지 않는다. 실제 jsdom 요소의 style.transform이 RAF 후 예상값으로 바뀌는 것을 검증했다. 원래 카드의 HTML/style 및 입력 노드는 변하지 않는다.

최종 pointerup 좌표가 마지막 pointermove보다 앞서 있어도 release 좌표로 한 번만 commit 콜백을 호출하며, 미처 실행하지 못한 RAF는 제거한다. 다른 pointerId 입력은 무시한다. pointercancel, lost capture, Escape, scope invalidate는 overlay를 제거하고 commit을 호출하지 않는다. 이 프로토타입에는 저장 API가 없으므로 취소가 저장을 만들 경로도 없다. 실제 제품의 저장 회귀 검증을 대신하지 않는다.

프로토타입은 모든 시작 지점에 `abs(dx) + abs(dy) < 4` 기준을 적용한다. 실제 preserve의 이 게이트는 `gesture.pending`인 인라인 타깃에만 적용된다. 따라서 헤더에서 시작한 작은 이동의 현행 동작과 동일하다는 검증은 아니다. 임계값을 넘은 뒤 시작점으로 돌아오면 no-op drop으로 처리한다. 기존 `nativeSelectionPlacements`를 재사용하여 ±1e7 경계에서 그룹 간 상대 위치를 유지한다. 프리뷰는 단순 제목 div이며 원래 카드의 인터랙티브 하위 트리를 복제하지 않는다.

## 비용과 제품 적용 시 남는 검증

이는 기능 프로토타입이며 브라우저 FPS/페인트/합성/실제 React 렌더 성능의 측정값이 아니다. jsdom은 레이아웃을 계산하지 않으므로 DOM 위치 측정의 정확성, pointer capture 실제 이벤트 순서, 화면상 잔상과 스타일을 검증하지 못한다. 실제 DOM 이벤트 등록과 capture는 아직 연결하지 않았다. 줌/카메라/문서/뷰 변경 시 호스트가 invalidateScope를 호출해야 한다.

이동마다 기존 clamp 함수를 호출하므로 선택 노드 수에 비례하는 복사 비용이 남는다. 제품에서는 시작 시 그룹 경계값을 계산해 이동의 clamp 비용을 고정시키는 방식을 검토할 수 있다. 현재 프로토타입 자체의 비용 개선율은 측정하지 않았다.

callback 1회는 실제 제품 장면 계산 1회를 보장하지 않는다. 현재 단일 카드 savePlacement가 drawn.nodes를 소비하는 경로는 고스트 마지막 좌표와 다를 수 있다. 제품 적용 시 최종 placements/commands를 직접 구성해야 하며, 상태 갱신 및 저장 완료 후 장면 재계산 횟수는 실제 통합 테스트로 확인해야 한다. 현행 이동 중 비용에는 로컬 draft 및 장면 갱신이 포함되며, 서버 저장이 모든 pointermove마다 발생한다는 의미는 아니다. 기존 로컬 draft 저장은 120ms debounce/1초 checkpoint를 사용한다.

관계선은 프리뷰 중 원래 노드 위치에 남는 설계다. 이를 허용할지, 경량 연결선 미리보기가 필요한지는 제품 결정이다. drop 직후 무거운 동기 장면/라우팅 비용도 별도로 남는다. 실제 UI 통합 전에는 단일/다중 카드, 선택 변경, 읽기 전용 전환, 원격 변경, 취소, 저장 실패, undo/redo 및 키보드 동작을 검증해야 한다.

프로토타입은 cleanup 후 commit 콜백을 호출한다. 실제 제품에서는 최종 장면 geometry가 준비될 때까지 마지막 고스트를 유지한 뒤 제거해야 drop 직후 이전 위치가 잠시 보이는 현상을 피할 수 있다. 이 표시 전환은 현재 테스트 범위에 포함되지 않는다.


