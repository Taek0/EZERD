# Untitled UI 브라우저 검증

작성일: 2026-09-14

- `browser-select.mjs`는 실제 `button.ui-select` 트리거와 화면의 `role=option`을 클릭한다. React Aria의 숨김 네이티브 select는 검증 조작 대상으로 사용하지 않는다.
- UI fixture는 `onValueChange(string)` API로 전환했다. 폼 제출, 버튼 disabled/loading, Checkbox, 입력 라벨, Select 마우스/키보드, disabled fieldset, Tooltip, ContextMenu, 선택된 탭을 검증한다.
- 테이블 검증은 FK 대화상자 안의 실제 팝업 선택, 모델에 저장된 카디널리티, UNIQUE 생성, 타입과 파라미터 변경을 검증한다.
- 전체 앱 검증은 사용자 Dropdown의 Enter/Escape/포커스 복귀와 동일 사용자 ID의 이름 변경을 추가했다. 실제 Canvas의 FK 팝업 첫 Escape는 선택 목록만, 두 번째 Escape는 FK 대화상자를 닫는지 검증한다.
- 전체 앱의 저장, 외부 참조, 두 사용자 댓글/멘션/답글/해결 및 다시 열기, 삭제된 대상의 댓글 유지, 모바일 가로 넘침 검증을 통과했다.
- 스크린샷은 `.cache/verification/untitled-components-select.png`, `untitled-components-menu.png`, `untitled-fk-select.png`에 저장한다. 팝업 진입/퇴장 속성이 없고 opacity=1 및 애니메이션 종료 상태를 기다린다.
- 브라우저 연결 실패가 기존 작업에서 확인되어, 로컬 테스트는 기존 Chrome headless Playwright 경로를 사용했다. 임시 fixture HTML과 검증용 사용자/프로젝트는 finally에서 정리한다.
- 검증 중 Vite HMR이 fixture 상태를 초기화한 실패는 소스가 안정된 후 재실행했다. Select Tab 닫힘 회귀는 별도로 재현하여 UI 담당자에게 전달했다. 수정 후 Tab은 disabled fieldset을 건너뛰어 Checkbox에, Shift+Tab은 직전 제출 버튼에 포커스하는 검증을 추가하여 통과했다.

최종 검증: `browser-ui-smoke.mjs`, `browser-table-workflow-smoke.mjs`, `browser-release-smoke.mjs` 모두 PASS. 전체 실행에서 pageerror 없음. 원본 옵션 선택 동작, 네이티브 FK 대화상자의 두 단계 Escape, 사용자 Dropdown 및 저장/댓글 흐름을 최종 수정 이후 재검증했다.

추가 수명주기 회귀: 열린 Select에서 fieldset.disabled DOM 속성 변경, React disabled/readOnly prop 전환 시 목록이 닫히고 선택값이 보존되는지 검증했다. 원복 후 목록이 저절로 다시 열리지 않으며 readOnly 중 트리거 클릭도 목록을 열지 않는 것을 확인했다. 해당 최소 수정 이후 UI smoke를 다시 실행하여 PASS했다.
