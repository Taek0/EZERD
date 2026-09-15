# 공통 UI 컴포넌트

## 위치와 범위

`apps/web/src/components/ui/index.tsx`에서 공통 컴포넌트를 내보낸다. Untitled UI React의 무료 MIT 기본 컴포넌트를 참고·수정해 적용했으며 React Aria의 Button, Tooltip, Menu 기반 동작을 사용한다. 입력·선택 컨트롤은 기존 폼 이벤트와 모바일 기본 선택 동작을 유지하는 네이티브 어댑터다.

원본 버전은 `c981a73bcd6b6c68d2a54070f20f020191212828`로 고정했다. 출처·수정 범위는 해당 폴더의 NOTICE.md, Untitled UI MIT 및 React Aria의 Apache-2.0 등 런타임 라이선스 전문은 `apps/web/THIRD_PARTY_NOTICES.md`에 있다. `pnpm docs:ui-licenses`로 설치된 브라우저 런타임 고지를 다시 생성한다. 빌드에도 `public/THIRD_PARTY_NOTICES.txt`를 함께 포함한다. 유료 PRO 컴포넌트 소스를 가져오지 않았다. 별도 아이콘 패키지도 제거하고 필요한 화살표는 자체 SVG로 작성했다.

## 제공 컴포넌트

| 컴포넌트 | 역할 |
| --- | --- |
| Button | 기본·주요·보조·위험 버튼, disabled/loading, 선택적 크기 |
| IconButton | 접근성 이름을 요구하는 아이콘 버튼, 선택적 툴팁 |
| Input / Textarea / Select | 네이티브 속성·이벤트·ref 호환, 오류 상태 |
| Checkbox | checked/onChange, indeterminate |
| Field | 라벨·도움말·오류를 입력의 ID와 연결 |
| Badge | 파랑·중립·성공·주의·오류, plain/subtle 표시 |
| Tooltip | 포인터와 키보드 포커스로 여는 도움말 |
| DisclosureButton / Collapse | 제어형 접기 버튼과 애니메이션·inert 본문 |
| Accordion | details/summary 기반 접기 영역 |
| ContextMenu | 포인터 위치 메뉴, 방향키·Escape·바깥 클릭·포커스 복원 |
| TabButton | 선택 상태가 있는 필터/세그먼트 버튼 |
| Avatar | 이니셜 등 콘텐츠를 담는 공통 아바타 |

## 사용 예

화면 파일에서는 다음과 같이 가져온다.

```tsx
import { Button, Field, Input, Select, IconButton } from './components/ui/index.js';

<Field id="project-name" label="프로젝트 이름" hint="팀에서 알아보기 쉬운 이름을 입력하세요.">
  <Input value={name} onChange={event => setName(event.target.value)} required />
</Field>

<Button type="submit" variant="primary" loading={saving}>저장</Button>
<IconButton aria-label="속성 패널 닫기" tooltip="속성 패널 닫기" onClick={closePanel}>×</IconButton>

<Select aria-label="적용 범위" value={scope} onChange={event => setScope(event.target.value)}>
  <option value="both">함께</option>
  <option value="logical">논리</option>
  <option value="physical">물리</option>
</Select>
```

Button의 기본 type은 `button`이다. 폼 제출에는 반드시 `type="submit"`을 지정한다. `onClick`과 Input/Select의 `onChange`는 기존 DOM 이벤트 형태다. 툴팁에는 공통 Button/IconButton처럼 React Aria의 포커스/트리거 컨텍스트를 받을 수 있는 자식을 사용한다.

크기 옵션은 `xs`, `sm`, `md`이고 기본값은 기존 화면 치수를 상속한다. 이미 조정된 홈 카드·입력·툴바에는 불필요한 size를 주지 않는다. 프로젝트 상태 배지는 `variant="plain"`으로 기존 글자·간격을 유지한다. TabButton은 aria-pressed를 가진 버튼이며 실제 tabpanel이 없는 곳에 가짜 tab 역할을 붙이지 않는다.

## 파란색 테마

기본 강조색은 기존 `--accent: #305be7`다. `tokens.css`의 `--ui-brand-50`부터 `--ui-brand-800` 계열, 포커스 링과 오류 색을 공통 UI가 사용한다. 사용자 지정 도메인 색상은 그대로 보존한다. 글꼴은 Apple SD Gothic Neo를 유지한다.

스타일 로드 순서:

1. `components/ui/tailwind.css`: Tailwind theme와 utilities. Preflight는 포함하지 않음.
2. `tokens.css`: EZERD 색상·폰트·공통 토큰.
3. `components/ui/ui.css`: 낮은 우선순위 기본값과 공통 상태·변형.
4. `styles.css` 및 화면별 CSS: 기존 치수와 배치.

컴포넌트 추가 시 화면의 일반 버튼/입력 전역 규칙을 새로 늘리기보다 공통 컴포넌트의 variant 또는 화면 범위 클래스로 조정한다. 선택된 탭, 오류/비활성 상태와 키보드 포커스가 전역 CSS에 덮이지 않는지 확인한다.

## 적용된 화면과 검증

App, Canvas, TableEditor, CommentsPanel의 기본 컨트롤을 공통 API로 교체했다. 도메인 관계 메뉴·접기 영역과 테이블 details도 공통 컴포넌트를 사용한다. 설계 모델·API·DB·DDL 로직은 수정하지 않았다.

- 단위 테스트: 컴포넌트의 폼 type·disabled/loading·라벨/오류 연결·네이티브 선택·접힌 콘텐츠 제외.
- `scripts/browser-ui-smoke.mjs`: 임시 로컬 테스트 화면에서 제출·로딩 차단·체크박스·선택·툴팁·키보드 메뉴·포커스·파란 탭을 검증하고 임시 파일을 제거한다.
- 기존 홈 치수를 비교해 카드 180×126px와 헤더·입력·푸터 크기가 유지됨을 확인한다.
- `scripts/browser-release-smoke.mjs`: 실제 캔버스·테이블·저장·댓글·멘션·DDL 회귀.

새 의존성으로 초기 JS 크기는 기존 약633KB에서 약798KB(압축 전)로 증가했다. 기존 청크 크기 경고는 남아 있으며, 화면/메뉴 지연 로딩은 별도 최적화 항목이다.
