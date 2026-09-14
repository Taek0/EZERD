# Untitled UI 공통 컨트롤 런타임 재구성

- 날짜: 2026-09-14
- 계획: `docs/planning/2026-09-14-UntitledUI-Rebuild.md`
- 기준: Untitled UI React MIT 소스 `c981a73bcd6b6c68d2a54070f20f020191212828`

## 구현

`apps/web/src/components/ui/untitled.tsx`를 실제 애플리케이션 공통 진입점에서 import하여 사용한다. 비활성 원본 파일을 추가하는 방식이 아니라, 확인한 공개 소스의 현재 필요한 가지를 런타임 컴포넌트로 옮겼다. 원본 Tailwind 클래스의 CSS 레시피는 `untitled.css`로 명시적으로 변환했고 `ui.css`가 import한다.

- Button: 원본 button 분기의 React Aria Button, 내부 텍스트 span, loading SVG 구조, xs/sm/md 크기, 색상·안쪽 테두리·그림자·100ms 전환을 사용한다. 제품 기본값은 secondary로 정했다. 로딩 중 시각적으로 숨긴 텍스트의 접근 가능한 이름이 사라지지 않도록 aria-label을 보완했다.
- Input: 원본 InputBase의 Group + 투명한 실제 입력 요소 구조, 8px 반경, 40px md 높이, 그림자와 inset ring, focus/error 상태를 사용한다. name/ref/onChange/readOnly/disabled 등 실제 입력 API를 유지한다. 사용하지 않는 비밀번호 보기·도움말·leading icon·shortcut 변형은 포함하지 않는다.
- Textarea: 원본 TextAreaBase의 입력 요소·16px 글꼴/24px 행간 레시피·8px 반경·오류/포커스 ring·resize handle을 옮겼다. native form/ref/rows를 유지한다.
- Checkbox: 원본 CheckboxBase의 16px indicator, 체크/indeterminate SVG와 상태 모양을 사용한다. 기존의 외부 label 중첩을 피하고 실제 form/ref/onChange와 disabled fieldset을 유지하기 위해 원본 전체 AriaCheckbox label 대신 시각적으로 숨긴 실제 input을 형제 요소로 둔다. 선택·부분 선택·포커스·비활성 상태는 native pseudo-class가 indicator에 반영한다.
- Select: 원본 Select의 AriaSelect → AriaButton/SelectValue → Popover → ListBox → SelectItem 트리를 사용한다. OS 선택 팝업은 화면에 나타나지 않는다. 기존 option/optgroup children을 collection으로 옮기고, form 제출과 자동완성용 hidden select는 React Aria가 관리한다. visible ref는 HTMLButtonElement이며 값 변경은 onValueChange(string)이다. native Select onChange 이벤트를 위조하지 않는다.
- Dropdown: 원본 dropdown의 Menu/Item 내부 컨테이너·padding·크기·hover/focus 상태·Popover 형태를 사용한다. 프로필 메뉴에 MenuTrigger/Popover를 적용하며 좌표 기반 우클릭 메뉴도 같은 실제 item 모듈을 사용한다.
- Tooltip: 원본 300ms 지연, 6px offset, title 컨테이너, fade/zoom/placement 이동을 반영한다.

## 애니메이션과 통합 처리

- Select/Dropdown Popover 진입 150ms ease-out, 퇴장 100ms ease-in, placement에 따른 2px 이동 및 fade를 원본 레시피대로 반영했다.
- Tooltip fade/zoom과 reduced-motion 대응을 추가했다.
- native modal dialog의 top layer 밖으로 Popover가 나가 사라지지 않도록 가까운 dialog를 portal container로 사용한다.
- Select는 disabled fieldset 조상과 첫 legend 예외를 확인하고 disabled 속성 변경을 관찰한다. readOnly 모드에서는 팝업을 닫고 루트의 캡처 단계에서 Tab 외 변경 키를 차단한다.
- Field는 label id 및 aria-labelledby를 연결해 버튼 기반 Select에도 이름과 설명을 전달한다.
- 남아 있는 Collapse/Accordion/Avatar/Badge는 이번 원본 컨트롤 이식과 별개의 기존 제품 공통 컴포넌트다. 해당 컴포넌트 전체를 원본으로 교체했다고 주장하지 않는다.
- 원본 CheckboxBase에 포함된 MIT SVG 외의 Chevron/Check/error 아이콘은 로컬 기하 도형이다. PRO 아이콘 패키지는 사용하지 않는다.

## 검증

- `pnpm --filter @ezerd/web typecheck` 통과.
- `pnpm exec vitest run apps/web/src/components/ui/ui.test.ts` 5개 통과.
- 단위 검증: 기본/submit 버튼, 로딩 disabled/name, Field의 label/hint/error 연결, visible listbox trigger, collapsed inert, native checkbox checked/name/disabled와 source indicator 공존, Input readOnly/name, Textarea rows/내용.
- 브라우저 검증은 별도 담당이 실제 테이블/FK 대화상자·UI 갤러리·모바일에서 수행하며 전체 결과는 통합 작업 기록에 남긴다.


## 브라우저 회귀 수정

- 실제 브라우저에서 React Aria 1.21.1 Select Popover의 modal focus containment가 열린 선택 목록의 Tab을 가두는 현상을 재현했다.
- Tab/Shift+Tab에만 공식 `shouldSkipAnimation`으로 즉시 닫고 원래 trigger에 초점을 돌린 뒤 브라우저의 기본 Tab 이동을 허용한다. 직접 tabbable 목록을 계산하지 않으므로 native disabled fieldset, 문서 순서와 dialog 범위를 브라우저가 유지한다. 선택·Escape·외부 클릭에는 기존 진입/퇴장 모션을 유지한다.
- 최종 Tab/Shift+Tab, FK dialog 및 통합 화면 확인은 브라우저 담당의 최종 실행 결과로 별도 기록한다.

### 최종 공통 UI 확인

브라우저 담당이 `scripts/browser-ui-smoke.mjs`를 통과시켰다. Tab은 disabled fieldset을 건너 다음 Checkbox로 이동하고, Shift+Tab은 직전 제출 버튼으로 이동하는 명시적 assertion을 통과했다. 로딩 버튼은 role과 한국어 접근 이름으로 조회된다. Tab 수정 후 공통 UI 단위 테스트 5개를 다시 실행해 통과했다.

통합 담당은 source `max-h-64!`의 `!important`를 명시하여 React Aria inline 높이보다 256px 상한이 우선하도록 수정했고 실제 팝업 높이 256px을 확인했다. source shadow의 검은색 값 및 Checkbox 100ms 상태 전환/reduced-motion도 마무리했다.

최종 리뷰에서 열린 Select의 disabled/fieldset disabled/readOnly 변경을 하나의 blocked 조건으로 통합했다. blocked 상태에서는 목록 열기와 값 변경을 막고 기존 local open을 닫아, 편집 권한을 되돌려도 목록이 저절로 다시 열리지 않도록 수정했다. 해당 수정 후 TypeScript 검증을 통과했다.

브라우저 추가 회귀도 통과했다. 열린 목록에서 fieldset.disabled, Select readOnly prop, disabled prop의 세 가지 전환을 각각 검사하여 팝업 닫힘·기존 값 보존·해제 후 자동 재열림 없음과 readOnly 클릭 차단을 확인했다. 전체 common UI smoke를 최종 통과했다.
