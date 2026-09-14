# Untitled UI 공통 컨트롤 사용 및 재구성 결과

작성일: 2026-09-14

## 적용
Untitled UI 공개 MIT 소스의 필요한 구조와 상태별 클래스 레시피를 로컬 JSX/CSS 수정본으로 옮겼다. 기존 네이티브 팝업 Select는 React Aria 기반 버튼·Popover·ListBox로 교체했다. CheckboxBase 표시, InputBase의 Group/입력창, TextAreaBase, 버튼, Dropdown/MenuItem, Tooltip이 실제 실행 모듈에 연결된다.

색상은 파란색, 폰트는 기존 한국어 폰트를 유지한다. Select/Dropdown은 진입150ms·퇴장100ms와 작은 위치 이동, 체크박스는100ms 상태 전환을 적용한다. 모션 감소 설정에서는 애니메이션을 끈다. Tab으로 다음 입력으로 이동할 때에는 즉시 닫아 포커스가 팝업에 갇히지 않게 한다.

앱 갤러리·캔버스·사이드바 배치는 그대로 사용한다. 접힘 패널·탭·아바타 등의 별도 제품 구성까지 원본 전체를 교체한 것으로 표현하지 않는다. 구체적인 원본 대응과 수정 사항은 [NOTICE](../../apps/web/src/components/ui/NOTICE.md), 원본 URL·해시는 [UPSTREAM](../../apps/web/src/components/ui/UPSTREAM.json)에 있다.

## 사용 API
```tsx
import { Field, Input, Select, Checkbox, Dropdown, Button } from './components/ui/index.js';

<Field label="이름" children={<Input value={name} onChange={e => setName(e.target.value)} />} />
<Select aria-label="타입" value={type} onValueChange={setType}>
  <option value="text">text</option>
  <option value="integer">integer</option>
</Select>
<label><Checkbox checked={enabled} onChange={e => setEnabled(e.target.checked)} /> 사용</label>
<Dropdown label="사용자 메뉴" trigger={<Button>사용자</Button>}
  items={[{id:'rename', label:'이름 변경', onAction:openRename}]} />
```
Select는 onChange DOM 이벤트 대신 onValueChange 문자열 값을 사용한다. 보이는 선택 컨트롤은 버튼과 목록이며 숨긴 네이티브 select는 폼·자동완성 용도다. 체크박스는 숨긴 네이티브 input으로 폼·ref 호환을 유지하고 SVG 표시가 시각 상태를 담당한다.

화면별 CSS에는 배치·크기만 지정하고 공통 컨트롤의 테두리·그림자·포커스 스타일을 광범위한 button/input/select 규칙으로 덮지 않는다.

## 브라우저 검증
- 실제 Select 버튼과 목록으로 값 선택, Tab/Shift+Tab, Escape 포커스 복귀, 비활성 항목/fieldset을 확인했다.
- 열린 Select에서 disabled·readOnly·fieldset 상태가 변경되면 닫히며, 값이 보존되고 해제 후 저절로 열리지 않는다.
- FK 확인 대화상자 안에서 드롭다운을 열고 선택할 수 있다. 첫 Escape는 목록만, 두 번째는 대화상자를 닫는다.
- 사용자 메뉴 열기·닫기·이름 변경 시 사용자 ID 유지, 저장·댓글·멘션·알림 회귀 검사를 통과했다.
- 긴 타입 목록의 실제 높이는256px로 제한되며 스크롤한다. 입력/선택 높이40px, 체크박스16px, 모바일390px 화면 가로 넘침 없음.

## 최종 결과
- pnpm check: 타입 검사·단위 테스트100개·프로덕션 빌드 통과. DB 통합 전용9개는 일반 실행에서 제외된다.
- browser-ui-smoke, browser-table-workflow-smoke, browser-release-smoke 통과. 동적 disabled/readOnly/fieldset 전환 회귀도 추가 실행했다.
- 실제 편집기 화면에서 원본 링/그림자,256px 팝업,체크박스 상태를 시각 검토했다. 버튼 텍스트 래퍼로 달라진 로고/카드/알림 배치도 보정했다.
- 원본 출처,컨트롤 및 화면 통합,브라우저 회귀를 커밋으로 분리했다. 기존 문서 분류 변경은 포함하지 않았다.
- 기존 대형 청크 빌드 안내는 남아 있고 빌드는 성공했다.
