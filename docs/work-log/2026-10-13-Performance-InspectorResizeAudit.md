# 우측 속성 패널 리사이즈 조사 결과

- 대상: 로컬 main 3124416. 제품 코드 변경 없이 현재 구현을 조회했다.
- NativeProjectView.tsx:1807의 onPointerMove는 setInspectorWidth를 직접 호출한다. 드래그 이벤트가 상위 편집기 state 갱신으로 이어지는 경로가 남아 있다. React 배칭/memo 때문에 이벤트 수와 모든 하위 컴포넌트 렌더 수가 같다고 단정할 수는 없다.
- 같은 파일 :397 부근 effect는 inspectorWidth가 커밋될 때마다 localStorage.setItem을 실행한다. 동기 저장의 반복 비용도 있으나 상대 기여도는 미측정이다.
- :1660 부근 gridTemplateColumns에 panelWidth를 삽입하므로 폭 변경이 실제 Grid 레이아웃과 캔버스 가용 영역 변경으로 이어진다. 이 필수 레이아웃 비용과 불필요한 React 갱신은 구분해야 한다.
- native-project-view.css:326은 data-resizing=true일 때 transition:none을 적용한다. 단순히 드래그 중 transition이 켜져 있어서 생기는 문제로 볼 근거는 없다.
- 앞선 081fc42는 PinPanelResizer 및 useNavigatorResize에만 rAF CSS 미리보기를 적용했다. 우측 속성 패널의 별도 inline 핸들러는 적용 대상에서 빠져 있었다.
- 후속 개선 범위: 우측 패널 폭을 CSS 변수로 연결하고 기존 createPanelWidthPreview를 재사용한다. 종료 시 width state/저장을 확정하며 pointerup 최종 좌표, cancel/lost capture, 다른 포인터 무시, unmount, 키보드 및 좁은 화면 clamp를 회귀 검증한다.
- 이번 조사는 코드 경로 확인이다. 실제 Chrome에서의 렉 재현과 시간 비중/FPS 개선율은 측정하지 않았으며, 현재 코드만으로 유일한 원인이라고 확정하지 않는다.

[조사 계획](../planning/2026-10-13-Performance-InspectorResizeAudit.md)
