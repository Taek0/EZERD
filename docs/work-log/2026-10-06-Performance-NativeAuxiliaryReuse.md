# Native 보조 UI 재사용 구현

2026-10-06. [계획](../planning/2026-10-06-Performance-NativeAuxiliaryReuse.md)에 따라 PNG·도메인 관계·스타일·클립보드·canvas action 컴포넌트의 props가 그대로인 카메라 갱신을 재사용한다. 기본 React.memo 비교만 사용하고 편집 context는 입력별 useMemo, canvas 명령 callback은 commit 이후 최신 ref로 연결한다. 카메라 전용 변경에서 문서 fingerprint와 native source 재검사를 피하되 snapshot/권한/personal writer 상태 변경 시 기존 guard가 다시 평가된다.

관련 Native canvas/PNG/스타일/클립보드/개인 상태 회귀와 타입 검증 결과는 최종 측정 문서에 기록한다. 최적화 전 raw는 이전 폴더에 보존하고 새로운 clean 빌드에서 같은 조건을 재측정한다.
