# Native 인스펙터·툴바 원본 UI 복원

- 계획: [전체 Canvas 복원 계획](../planning/2026-10-06-Canvas-CompleteParityRestoration.md)
- 기준: main a9404b1의 `Canvas.tsx`, `TableEditor.tsx`, 도메인 폼·색상 선택기, 공통 UI, `shared/editor/panel.tsx`, `styles/inspector.css`, App 편집 shell.
- 담당 범위: NativeProjectView/CSS, Property/Domain/Advanced/Format/Form/Structure editor, Toolbar/DomainFilter/HistoryControls 및 관련 집중 테스트.
- 부모 담당 Canvas 조작·메뉴·직접 생성과 시각 담당 Scene/Rows/관계선 파일은 이 변경의 수정·커밋 대상에서 제외했다. Native 모델과 저장·권한·capability·ACK 검증은 유지한다.

## 원본과 복원 항목

| 원본 구성·동작 | Native 복원 내용 |
| --- | --- |
| Canvas 인스펙터의 VIEW/DOMAIN 경로, 선택 이름, 속성·목록 탭 | 전체 테이블·도메인·개인 뷰의 실제 이름을 표시한다. 도구 탭을 명시하고, 검색 때문에 선택한 테이블의 속성이 사라지지 않게 했다. |
| 도메인·관계 또는 테이블·관계 검색과 목록 | 동일 PanelSection/PanelList/PanelRow로 검색·관계 목록, 컬럼/관계 수, 도메인 색상·소속 배지를 표시한다. 도메인 관계를 선택하면 기존 관계 editor의 selectedId로 연결한다. |
| 기본 정보의 이름·설명과 테이블 소속·색상 | 물리/논리 이름·설명을 현재 모드에 맞게 표시한다. 원본 description의 자동 높이·너비 변경 대응을 복원했다. 소속 변경은 이동 영향 검토가 있는 NativeDomainEditor를 연다. 색상·NULL/설명 표시 옵션은 format 초안을 통해 patch_canvas_style로 저장한다. |
| 접히는 도메인 생성·기본 정보·삭제 UI | 공통 PanelSection과 DomainColorPicker를 유지하고 작업 버튼, 선택 도메인의 조회 정보, 이동·삭제 정책/영향 검토를 제공한다. |
| 컬럼 순서 변경, 행 상태와 펼침 애니메이션 | 원본 PanelListDetail을 사용한다. 드래그/드롭 상태 클래스를 복원하고 키보드 방향키 재정렬, 컬럼 삭제·닫기·PK 편집 진입을 제공한다. |
| 컬럼의 논리 속성 | format 초안에 의미 타입·필수 여부를 추가했다. 논리 모드는 물리 타입 폼 대신 논리 속성을 보여 주며 물리 타입·옵션을 변경하지 않는다. |
| 키·PK/UNIQUE 생성·수정·삭제 | 키 행의 배지/컬럼/DB 옵션, 공통 펼침 애니메이션, 대상 키의 contextual constraint 폼과 생성·삭제 영향 검토를 연결했다. capability·컬럼 준비 상태 검증은 기존 경로를 사용한다. |
| 생성·수정 메뉴에서 특정 작업 열기 | focused NativeStructureEditor가 이미 요청된 객체/작업을 직접 연다. 중첩 작업 Select를 없애고 초안 key/생성 ID/검증/ACK 소비 규칙은 유지한다. 생성 기본값은 ID를 바꾸지 않는다. |
| ENUM 관리와 값 편집 | 전역 ENUM 목록, 스키마·값 수·값 표시, 펼침 수정/삭제/생성 진입을 제공한다. 기존 NativeLabelFields의 정확한 문자열/순서 보존과 DB별 지원 검사를 유지한다. |
| 인덱스·CHECK·식 편집 | 공통 애니메이션 PanelSection과 선택 가능한 PanelRow 목록으로 복원했다. 고급 구조식·DB 옵션 editor는 기존 Native 구현을 사용한다. |
| 메타데이터 정보 | 공통/논리/물리 영역을 행별 이름·값·추가·삭제 UI로 제공한다. JSON 원문 입력 대신 불완전한 행도 durable 초안에 보관하고, 빈 이름/중복/타입/개수/길이를 검증한다. 편집하지 않은 영역은 유지한다. |
| 원본 툴바의 경로·생성·보기·공유·패널 버튼 | 전체 테이블/도메인 맵 버튼, 개인/도메인 뷰 드롭다운, 필터 배지·해제·취소, ENUM 진입, 공유 드롭다운과 생성/붙여넣기/경로 초기화/도구 메뉴를 공통 Dropdown/IconButton으로 제공한다. 기존 exportControl도 계속 받는다. |
| 자동 배치 | onAutoLayout 선택적 콜백과 직접 버튼/메뉴 항목을 추가했다. disabled 및 배치 편집 권한으로 차단한다. 부모 Canvas가 실제 명령을 연결한다. |
| 도구·배율과 이력 접근성 | V/H 도구의 선택 상태와 툴팁, 배율/중앙 버튼 툴팁을 유지한다. 이력 버튼에 Ctrl/⌘ Z 및 Shift Z 단축키·툴팁을 추가하고 실제 durable 이력 함수를 호출한다. 입력·다이얼로그·busy·미확인 요청은 단축키에서 제외한다. |
| 패널·모션·반응형 | 공통 inspector 스타일을 덮어쓰던 이전 목록 버튼/그리드 규칙을 제거했다. 하나의 스크롤 패널, 원본 접힘 컴포넌트, 패널 열기/닫기 전환을 사용한다. 좁은 화면은 아래 도킹하며 닫힌 상태에 빈 행이 생기지 않도록 했다. reduced motion에서는 패널 전환을 적용하지 않는다. |

## 부모 Canvas 연결 API

NativeProjectView는 아래 선택적 콜백을 Canvas props에 전달한다. 부모가 NativeERDCanvas의 props와 메뉴 handler에 선언/연결해야 한다.

```ts
onRequestStructure?: (
  action: 'patch' | 'delete' | 'foreignKey' | 'column' | 'key' | 'enum',
  target: string,
  tableId?: string,
) => void;
onRequestAction?: (
  action: string,
  target: string,
  values?: Record<string, string>,
) => void;
```

- patch/delete의 target은 `JSON.stringify(['keys' | 'columns' | 'tables' | 'tableRelations' | 'enums' | 'indexes' | 'checks', objectId])` 형식이다.
- create 계열의 target은 빈 문자열이다. `values.tableId`는 인스펙터 대상 테이블이고 나머지 값은 contextual 생성 기본값이다. 생성 ID는 폼의 durable ID를 유지한다.
- onRequestAction은 table/column/key/index/check/enum/foreignKey/patch/delete 외에 tools, domain, enums(목록 열기), domainRelation(target=관계 ID)을 받는다. 입력된 action이 허용 목록에 없으면 무시한다.
- Toolbar의 선택적 callbacks: onAutoLayout, onResetRoutes, onPaste, onExportProject, onExportDDL, onExportPNG, onOpenEnums, exportBusy. onOpenEnums는 onRequestAction('enums', '')로 연결할 수 있다. callback이 없는 메뉴는 표시하지 않거나 비활성화하며 기존 호출자는 호환된다.

## 검증

- 원본/Native 파일과 기존 tests를 대조했다. 최종 집중 회귀는 **24개 파일 / 317개 테스트 통과**, `pnpm --filter @ezerd/web typecheck` 통과, 담당 파일의 `pnpm exec prettier --check` 및 `git diff --check` 통과다.
- native-private-recovery-busy 테스트는 useState 호출 번호 대신 saving/pendingBlocked라는 operation state 의미를 기준으로 검사한다. queue 상태만 pending/unknown일 때 recoveryBusy가 false이고 외부 작업·초기화·shared save 중에는 true인지 확인한다.
- 추가 집중 검증: PostgreSQL/MySQL/SQLite의 논리·메타데이터 patch가 기존 타입·미편집 영역을 보존하는지, 중복/빈/잘못된 메타데이터가 거부되는지, 색상 초기화·표시 옵션이 Native style 명령인지, contextual 폼이 생성 ID를 보존하는지, 자동 배치 busy guard와 실제 경로 표시.
- 전체 check/build, 브라우저/DB/실데이터 조작은 이 담당 범위에서 실행하지 않았다.

## 남은 통합·차이

- NativeERDCanvas 메뉴의 inspector 요청 콜백과 optional Toolbar 추가 메뉴/ENUM 목록 콜백은 부모의 최종 연결이 필요하다. 이 커밋은 Canvas의 handler를 수정하지 않는다.
- 목록에서 도메인 화면을 직접 여는 원본의 '열기' 단추는 Canvas의 imperative/controlled view 요청 API가 없어 아직 추가하지 않았다. 툴바의 보기 드롭다운으로 도메인·개인 뷰를 연다.
- 선택 노드의 위치/크기·메모·관계 경로 직접 편집, PK→FK 연결 제스처, 직접 생성 시 클릭 좌표, 공유/내보내기 App shell 통합은 부모 Canvas 범위다. 일반 Native FK 생성/수정 폼은 인스펙터에서 접근할 수 있다.
- Native는 durable 초안과 검증을 위해 저장/초기화·이동/삭제 영향 검토를 표시한다. 원본 v1의 모든 입력 즉시 저장 방식으로 바꾸지 않았다.
- 사용자가 코드·서버 검증만 선택하여 브라우저 검증은 제외했다. 열기/닫기·툴팁·좁은 화면·reduced motion은 코드와 공통 컴포넌트를 대조했다. SSR/command 테스트를 실제 브라우저 검증으로 간주하지 않는다.
