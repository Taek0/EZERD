# Native 인스펙터 감사 항목 후속 복원

계획: [후속 복원 계획](../planning/2026-10-06-Canvas-InspectorAuditCompletion.md). 기준: [전체 감사의 항목·근거](2026-10-06-Canvas-ParityAudit.md), 원본 Canvas/TableEditor/EnumManager/inspector-state/canvas-viewport/App shell. 첫 단위 6453eda 이후의 독립 작업이다.

## 항목별 결과

| ID | 구현·검증 결과 |
| --- | --- |
| E07 | 실제 NativeAutoTextarea를 테이블·컬럼·관계 설명에 사용한다. 첫 단위의 구현을 유지하며 scrollHeight+border 측정, 너비 변경 재측정, observer 해제 테스트를 추가했다. CSS의 수동 resize/스크롤을 설명 입력에 한정해 원본처럼 제거했다. shared form/inline 담당 파일은 변경하지 않는다. |
| V03 | 검색을 trim+locale lowercase로 정규화했다. 도메인 관계의 이름·설명·양쪽 도메인 이름을 검색하고 검색 결과 수를 표시한다. |
| V04 | 도메인 목록 Open을 requestedView 요청으로 연결했다. 실제 Canvas scope의 표시 객체로 테이블·관계 목록/요약을 구성하며 개인/도메인 문맥의 참조 배지와 표시 컬럼 수를 제공한다. |
| V05 | 원본 popup bottom-start/shouldFlip=false/offset8과 안내 문구를 복원했다. 전체 여부를 명시적 draft flag로 관리하여 모든 도메인을 개별 선택한 finite filter가 동적 null/all로 바뀌지 않게 했다. Apply/Close는 transactional이다. |
| R01 | domainRelation 요청과 목록 선택이 selectedId를 가진 하나의 contextual 관계 editor를 연다. 조회 전용 의미/설명, 수정·삭제 quick action, 이름 focus와 선택 heading을 제공한다. 동일 객체의 scope 갱신은 명시적으로 연 관계의 선택을 덮어쓰지 않는다. |
| R03 | 관계 설명/cardinality/required/endpoint min·max를 기존 constraint 초안에 추가했다. fallback은 표시 시 계산하고 편집한 필드만 patch한다. 미편집 explicit endpoint와 physical/FK 옵션은 보존한다. |
| R04 | 원본 PK/UNIQUE→FK 순서의 번호 있는 coupled mapping과 pair 추가/삭제, 끝점 선택·FK 제거 UI를 구현했다. 불일치/중복/다른 테이블 컬럼을 거부한다. **끝점 변경과 physical:null 저장은 현재 Native 계약에서 거부하므로 해당 컨트롤을 명시적으로 비활성화한다. 부모의 계약/서버 확장 전에는 완전 구현으로 간주하지 않는다.** |
| R05 | 연결된 테이블 관계를 원본 PK→FK 방향의 PanelRow/PanelListDetail로 표시하고 그 위치에서 동일 NativeTableRelationInspector를 펼쳐 편집한다. readonly도 이름·설명·endpoint·mapping·referential action을 조회한다. |
| R06 | 선택 도메인의 Open/+Relation/연결된 도메인 관계 목록을 복원했다. +Relation과 부모의 domainRelation('', {sourceDomainId}) 요청 모두 source seed를 전달하며 새 관계의 target은 다른 도메인으로 선택한다. 기존 durable 생성 초안이 있으면 그것을 유지한다. |
| N04 | table의 inherited picker와 domain의 unset swatch fallback을 원본/scene의 #8993a3로 맞췄다. Reset은 기존 native style/domain patch 경로를 유지한다. |
| N05 | Native canvas rows의 membership 계산을 재사용하여 PK FK UQ를 함께 표시한다. scope/table guard를 유지한다. |
| N06 | 첫 단위의 drag/drop 클래스·cleanup을 유지한다. 상세의 위/아래 controls를 실제 reorder_columns 저장 경로에 연결했다. |
| N07 | 실제 column PK checkbox와 Native 계획을 추가했다. nullable=false와 key 추가/patch를 한 배치로 처리하고 키 이름·deferrable·다른 컬럼의 타입/default/generation/options를 보존한다. 참조 FK, 생성 컬럼의 supporting key, SQLite WITHOUT ROWID 등 제거 차단을 표시하고 물리 FK를 암묵적으로 제거하지 않는다. |
| N08 | 원본 native dialog/modal/backdrop/Escape/close/focus return과 검색/list/detail를 갖춘 NativeEnumDialog를 제공한다. 생성/수정은 NativeStructureEditor+NativeLabelFields, 삭제는 native impact form을 사용한다. newline/empty/order/DB 차이는 유지한다. ENUM entry가 creation-only 폼을 바로 열지 않는다. |
| S01 | 원본 ezerd.inspector/ezerd.inspectorWidth preference를 읽고 저장한다. storage 실패는 optional preference로 처리하며 shared design과 분리한다. |
| S02 | 원본 inspectorBounds/clampInspectorWidth/readInspectorWidth/shouldStackInspector를 재사용한다. 측정 너비 기준 bounds, Home/End, Shift+Arrow40/Arrow10, primary pointer/capture cleanup과 drag 중 transition 억제를 구현했다. |
| S03 | 실제 workspace ResizeObserver로 comments가 차지한 너비까지 반영한다. 측정 기반 stacked inspector는 min(40%,240px), canvas min-height0, 단일 패널 body scroll을 사용하고 원본 <=1120 comments 배치를 상속한다. viewport900 기준과 canvas 최소360px 정책을 제거했다. |
| S04 | 원본 gallery→project→path, save-controls, toolbarHost hierarchy를 View에 복원했다. Toolbar는 pathHost로 portal하거나 undefined이면 로컬 표시하고 null 준비 상태는 숨긴다. panelToggle은 원본 comments SVG/공통 panel group을 사용한다. 개별 header projectActions를 제거하고 root renderExportActions에 전달해 공유 dropdown을 합친다. |
| S10 | native queue/초기화/전송/미확인 pending/error/오프라인/보관 입력을 구분한 shell status를 제공한다. 깨끗한 상태는 '저장 기준 확인됨'이며 live synchronized라고 표현하지 않는다. archived project/workspace와 viewer 안내를 원본 위치에 제공한다. workspace notice는 App의 정확한 metadata prop이 필요하다. |

N03도 함께 수정했다. format inspector의 unset showComment는 scene/metrics/원본처럼 true다. 이전 시험은 명시적 stored false를 지정하여 '편집한 표시 flag만 patch'하는 의미를 유지했다.

## 부모 통합 API

NativeProjectView는 실제 Root에 다음 props를 전달한다. 부모 NativeERDCanvas의 구현은 이 단위에서 수정하지 않는다.

- requestedView?: `{id:string;nonce:number}` — 도메인 목록/선택 도메인 Open. 부모가 unified domain filter navigation을 적용한다.
- onCanvasScopeChange — `{viewId,filter,visibleObjectIds,selectedObjectId,selectedNode}`. 현재 부모의 visibleObjectIds는 node/object ID이므로 관계는 표시된 양쪽 테이블로 판별한다. 공유/개인 메모의 정보는 onReviewContext가 제공하는 실제 display document에서 찾는다.
- selectedColumnId, toolbarHost, pathHost, panelToggle, selectionHost. note/domain host는 실제 선택 종류에 맞춰 바뀌며 부모 NativeSelectedObjectInspector가 layout/style/note 명령을 렌더링한다. 메모 선택은 이전 테이블 property를 제거한다.
- renderExportActions: `(png:{run:()=>Promise<void>;disabled:boolean;busy:boolean}) => projectActions(focusIssue,png)`는 projectActions가 있을 때만 전달한다.
- View의 projectActions 타입: `(focus:(id:string)=>void, png?:{run:()=>Promise<void>;disabled:boolean;busy:boolean})=>ReactNode`.
- View의 workspaceStatus?: `'active'|'archived'`, workspaceRole?: `'owner'|'admin'|'editor'|'reviewer'|'viewer'`. App에서 실제 projectWorkspace 정보를 전달해야 workspace notice가 정확히 렌더링된다.
- 기존 onRequestAction은 domainRelation(target=관계ID), domainRelation('',{sourceDomainId}), createDomainRelation(target=sourceID), tableRelation(target=관계ID), enums, tools와 구조 명령을 처리한다. 원본 direct creation/inline/route/exports는 각각 부모/다른 에이전트 소유다.

R04 저장 확장에 필요한 정확한 변경은 `packages/contracts/src/native-editor-command.ts`의 nativeForeignKeyPatchSchema와 NativeForeignKeyPatch에 sourceTableId/targetTableId 및 physical:null을 허용하고, `apps/server/src/mcp/native-editor-candidate.ts`의 patchNativeConstraintForeignKey가 endpoint 변경/명시적 physical 제거를 지원하도록 하는 것이다. native locked candidate 검증·키/컬럼 호환성·baseline/ACK·capability를 유지해야 한다. 이 인스펙터는 현재 schema의 safeParse로 지원 여부를 판단하며 schema가 확장되면 컨트롤이 활성화된다. v1이나 delete/recreate identity 우회는 사용하지 않았다.

## 검증

- 최종 focused 회귀는 **28개 파일 / 339개 테스트 통과**다. 기존 inspector/domain/constraint/labels/history/recovery 회귀와 새 semantic command/PK/scoped outline/description/modal 생명주기 테스트를 실행했다. web typecheck, 담당 파일 Prettier check와 git diff --check도 확인한다.
- autosize 테스트는 실제 component의 ref/measurement effect를 가짜 textarea/ResizeObserver에서 실행한다. ENUM 테스트는 실제 component의 showModal, cancel, close, 이전 connected focus restoration을 격리해 검증한다. 브라우저·스크린샷 검사로 표현하지 않는다.
- 사용자 결정에 따라 코드·서버 검증만 한다. 이 단위는 전체 check, DB/실데이터 변경, browser를 수행하지 않는다. 부모가 별도 server/HTTP 및 전체 integration 검증을 담당한다.

## 아직 남은 정확한 항목

- R04 endpoint reassignment/physical-only removal은 위 계약·server 확장 및 실제 HTTP 검증이 필요하다. coupling/논리 의미 UI가 있다는 이유로 저장까지 완료라고 보고하지 않는다.
- V01/V02/V06의 Root effective scene/navigation, R01/R02의 SVG selection callback, S04 export portal, 선택 note/domain geometry 및 S10 App metadata prop은 부모 Root/App의 실제 call-site 연결을 포함해 통합 검증해야 한다.
- 부모 소유 E01/E03/E04/E05/E06, R07/R08, S05/S06/S11은 이 단위가 수정하거나 완료 판정하지 않는다.
