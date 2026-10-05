# 패널 상태와 캔버스 렌더 경계 분리

- 계획: [PanelTransitions](../planning/2026-10-06-Performance-PanelTransitions.md).
- 전체 NativeProjectView 계측에서 100×10 기준 핀 전환 한 번에 행 400회/인라인 셀 12,400회가 실행되었다. 원본 220ms 애니메이션보다 React 작업이 훨씬 길었다.
- NativeCanvasWorkspace 경계에 useCommittedEvent를 적용해 이벤트 함수의 참조를 안정화했다. 호출은 마지막으로 commit된 함수로 전달하고, 미commit render나 오래된 권한/저장 함수를 재사용하지 않는다. 렌더 중 실행되는 renderExportActions에는 적용하지 않았다.
- Inspector 제약과 stacking 결과가 동일한 940px 이상 작업 영역은 관측 상태를 940으로 정규화한다. 좁은 폭의 실제 bounds/stacking 계산은 유지한다. CSS의 width/grid 220ms 전환은 변경하지 않았다.
- callback 교체/미commit render/optional 제거/Promise 전달, responsive bounds 동등성 테스트를 추가했다. 관련 회귀 6개 파일·79개 및 web typecheck 통과.
- 성능 개선량과 최종 검증은 후속 전체 editor 재측정으로 확인한다. main/원격은 변경하지 않는다.
