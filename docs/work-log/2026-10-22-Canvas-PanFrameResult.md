# 캔버스 팬 프레임 병합 결과

[구현 계획](../planning/2026-10-22-Canvas-InteractivePerformancePlan.md)의 1번을 구현했다.

- 팬 pointermove의 최신 카메라는 ref에 즉시 저장하고 React 상태 반영만 requestAnimationFrame당 한 번 수행한다. 휠과 배율 버튼은 즉시 반영하며 최신 카메라를 사용한다.
- pointerup은 release 좌표를 포함해 동기 flush한다. cancel, lost capture, blur는 마지막 pending 입력을 flush한다. 다음 팬은 최신 카메라에서 시작한다.
- 사용자·프로젝트·뷰 변경과 unmount의 layout cleanup에서 프레임과 제스처를 폐기한다. 프레임 generation 검사는 취소된 callback이 재호출되어도 새 scope의 입력을 소비하지 않게 한다. StrictMode 재실행 후에도 재사용된다.
- 기존 marquee scheduling과 scene 의존성은 변경하지 않았다. 직접 추적만 유지하며 spring, 관성, GPU layer hint를 추가하지 않았다.

## 검증

실제 React root와 DOM PointerEvent 대체 MouseEvent, React Profiler 및 제어 가능한 RAF를 사용하는 기존 lifecycle 테스트를 확장했다. 100개의 독립 pointermove를 전달했을 때 프레임 전 commit은 0회, 프레임 실행 후 1회다. 다음 pending move와 최종 release는 추가 commit 1회이며 release 좌표를 보존한다. 즉시 휠, pending 팬 이후 toolbar 줌의 중심 앵커, 새 제스처, cancel/lost capture, 사용자·프로젝트·뷰·unmount와 StrictMode에서 오래된 callback 폐기를 검증했다.

- camera-frame, NativeERDCanvas lifecycle/interaction/marquee: 최초 65개 통과. 추가 줌 앵커 테스트를 포함한 lifecycle 11개 통과(총 66개).
- `pnpm --filter @ezerd/web typecheck`: 통과.
- 기존 fake hook interaction harness는 프레임을 기다리는 시점만 보완했다. 새 fake hook engine은 도입하지 않았다.

작업 횟수 감소를 확인한 결과이며 실제 브라우저 FPS 또는 프레임 시간 개선율은 측정하지 않았다.
