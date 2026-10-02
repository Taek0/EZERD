# Native orphan/cross-tab draft 복구 결과

- 계획: [NativeDraftRecovery](../planning/2026-10-02-Database-NativeDraftRecovery.md).
- 선행 NativeLegacyImport는 helper 14, 실제 AppModule transfer 46(신규 legacy 27 + 기존 transfer 19), history 36 통과와 결과 기록을 완료한 후 본 단위를 진행했다. 기존 transfer 두 기대값은 새 graph/원문/audit 정책에 맞게 수정했다.
- 사용자 지시대로 git add/commit하지 않았다. archive 단위 ready 후 승인된 범위로 NativeProjectView 최소 연결까지 진행했다. 계약/서버/모델/공통 index/AppModule/MCP는 변경하지 않았으며 동시 agent의 UI 변경을 보존했다.

## 변경 범위

- 새 `apps/web/src/features/projects/native-draft-archive.ts` 및 동명 test: document runtime마다 cryptographic writer ID를 만들고 snapshot별 고유 key와 writer 전용 head를 사용한다. sessionStorage writer ID 재사용은 하지 않는다. 원문 values/before/expected/revision, 보관 시각과 복구 원본 entry ID를 보존한다.
- `native-editor-draft.ts`, `native-save.ts`: 기존 exported 저장/조회/폐기/reset/rebase API와 wire DTO를 유지하면서 writer별 archive로 연결했다. 일반 form load는 다른 writer/legacy 입력을 자동 채택하지 않는다. legacy 입력은 명시 복구가 필요하며 legacy 공유 key를 덮어쓰거나 삭제하지 않는다.
- `native-save.ts`, `native-save.test.ts`: stage의 기존 IDB claim callback에서 실제 전송 대상으로 확인한 editor/property snapshot을 operation/request fingerprint와 함께 로컬 sidecar에 보관한다. accepted ACK와 accepted cancellation은 그 origin만 소비한다. 새 입력/복구 사본/다른 writer 및 actor/project가 다른 입력을 지우지 않는다. sidecar 없는 구형 pending은 새 archive를 지울 근거가 없으므로 보수적으로 보존한다. rejected 결과는 입력을 유지한다.
- `native-durable-drafts.ts`: scope별 memory 원문 조회 API 추가. quota/읽기/삭제 오류 때 원문을 남긴다. 복구 사본이 실패 입력을 대체하려면 실패 memory를 먼저 archive에 보존해야 한다.
- 새 `NativeDraftRecoveryPanel.tsx` 및 동명 test: actor/project 전체 archive를 조회하므로 삭제된 object와 닫힌 form도 접근한다. 원문 다운로드, 명시 복구 사본, 정확한 snapshot 폐기를 제공한다. corrupt 원문은 복구하지 않고 다운로드/폐기만 제공한다. 저장소를 읽을 수 없어도 실패 memory 다운로드/명시 폐기를 제공한다. live actor와 최신 props를 확인해 이전 계정/project/storage의 handler를 차단한다.
- `project-ddl-export.ts`: 저장 정책 전환에 필요한 최소 local guard 연결. 명시 storage의 memory dirty/failure를 확인하며 legacy 원문의 writer별 명시 dismissal을 반영한다. 기존 export API와 snapshot 확인은 유지한다.
- 새 `native-draft-recovery-target.ts`/동명 test, `NativeProjectDraftRecovery.test.ts`, `native-recovered-forms.test.ts`: 실제 producer key를 현재 문서의 객체/소속/view와 대조해 form을 선택한다. 권한/서버 authority helper가 아니며 현재 객체를 다시 생성하거나 ID를 remap하지 않는다.
- `NativeProjectView.tsx`: panel 열기, live currentTransferUserId + user/project/root generation/unmount 검사, shared와 personal 권한 분리, 선택 form과 recovery epoch remount 연결. 복구에서 stage/rebase/send하지 않는다. 기존 canPersonalEdit과 save의 captureNativeActorApi-before-stage 순서는 보존했다.
- `native-editor-structure.tsx`, `NativeAdvancedEditor.tsx`, `NativeDomainEditor.tsx`, `NativeERDCanvas.tsx`, `NativeCanvasStyleEditor.tsx`, `NativeDomainRelationEditor.tsx`: 초기 action/target 선택 최소 props. 개인 view를 기다리는 동안 shared fallback action form을 열지 않는다.
- `NativeDomainEditor.test.ts`, `NativeERDCanvas.test.ts`: 부모 QA에서 발견한 exact random draw 3회 assertion 두 곳을 수정했다. MockResult return/Uint8Array narrowing 후 실제 인자/반환 bytes 일치, UUID v4 형식/고유성을 검증한다. crypto.randomUUID/subtle 없는 HTTP LAN 환경과 save 미호출 검증을 유지했다. Canvas.test의 다른 테스트 hunk는 수정하지 않았다.
- 최종 인계 범위는 코드/테스트 22파일의 담당 hunk + 문서 2개다. 동시 agent 파일의 전체 diff가 본 단위 소유라는 의미는 아니다.

## 보관/경합 정책

- 새 snapshot은 고유 key이며 현재 writer의 head만 갱신한다. 다른 탭의 입력을 덮는 공유 object key를 새로 쓰지 않는다. pointer 기록이 실패한 snapshot도 복구 목록에 남는다.
- 일반 form이 다른 writer 원문을 자동 load/rebase/send하지 않는다. 명시 복구는 expected를 원래대로 유지하고 editor revision은 새로 만든다. 원본 entry/revision은 계속 보관한다. DB revision/stale expected/actor 검사는 기존 경로대로 유지한다.
- legacy 공유 key의 폐기는 content fingerprint에 대한 writer 전용 dismissal이다. read→remove 경합으로 다른 탭이 쓴 새 원문을 삭제하지 않는다. raw가 변경되면 새 복구 대상으로 다시 나타난다. legacy 실제 bytes는 보존된다.
- 고유 archive snapshot의 명시 폐기와 ACK 소비만 실제 record를 삭제한다. head가 손상되어 다른 writer를 가리키더라도 reset은 다른 writer 원문을 지우지 않는다.
- 자동 prune는 하지 않는다. snapshot 누적으로 quota에 도달하면 저장 실패를 드러내고 memory 입력을 남긴다. panel에서 다운로드/명시 폐기 후 재시도할 수 있다. 이 보관은 로컬 입력이며 서버 저장/권한/legacy provenance의 authority가 아니다.

## Targeted 검증

- 최초 archive ready 검증은 Vitest 13파일 **146 passed**, 실패/skip 없음:
  - 새 archive 15 + 새 panel 6 + native-save 27 + 기존 editor draft 6.
  - clipboard/clipboard interaction, export state, private canvas, cancellation, DDL/versioned export, history/upgrade 회귀 포함.
  - interleaved 두 writer, foreign 자동채택 차단, 동일 텍스트 복구 사본의 old ACK 보호, 실제 stage→send accepted ACK, legacy 변경 경합, 원문 보존, actor/project guards, corrupt archive/legacy, pointer 실패/손상, quota memory, 폐기 실패 검증.
- 담당 파일과 연결 imports를 포함한 strict targeted TypeScript noEmit 통과. ES2023/DOM/DOM.Iterable, ESNext/Bundler/react-jsx, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 사용. root app 전체 typecheck/build를 주장하지 않는다.
- root 연결 후 최종 targeted Vitest **22파일 298 passed**, 실패/skip 없음. 위 13파일과 새 routing/root/form 3파일, 기존 NativeProjectView/NativeDomainEditor/NativeERDCanvas/native-editor-ui/native-advanced-editor-ui/native-canvas-decoration을 포함한다.
- root live actor/permission 변경, project A→B→A generation과 unmount, 실제 panel copy→form 선택/remount, render 이후 대상 삭제→copy 금지, stale expected 원문 보존, shared readonly + personal 허용 분리, actual React SSR의 초기 form 선택/private view 대기를 검증했다.
- 부모가 지적한 LAN MockResult undefined typing 두 오류도 수정한 뒤, root와 새 helper/tests 및 두 LAN test를 포함한 최신 strict targeted noEmit을 재실행해 통과했다. 본 단위에서 native contract union 오류를 수정하지 않았고 main의 공유 emit 후 해결됨을 확인했다.
- 담당 코드/테스트 22파일 Prettier와 diff whitespace 검사 통과. Advanced WIP 경고는 해당 agent의 마무리 후 별도 재확인에서 통과했다.
- panel 테스트는 React element와 hook state/버튼 handler를 실행한다. 실제 브라우저 렌더링/storage event/two-tab end-to-end QA를 수행했다고 주장하지 않는다. 전체 pnpm check/build는 실행하지 않았다.

## Root에서 지원하는 source format/key

source는 기존 로컬 Draft API 형식이다. property payload 또는 editor payload를 검증한 archive envelope formatVersion 1과 명시 legacy 복구를 읽는다. editor raw JSON/token을 해석해 arbitrary command를 자동 실행하는 reader가 아니다. v1 프로젝트 editor는 본 native root 대상이 아니다.

| category / logicalKey | 명시 선택 대상 |
| --- | --- |
| property / `JSON.stringify([table 또는 column, objectId])` | 현재 table/column 소속을 확인한 NativePropertyEditor |
| editor / `format:table:<id>`, `format:column:<id>` | property pane를 해당 table/column으로 remount하고 포함된 NativeFormatEditor 열기 |
| editor / `create:<table,column,key,index,check,enum,foreignKey>:<tableId 또는 project>` | NativeStructureEditor 초기 action. project owner는 table/enum만 지원. before.id/values.id가 같고 현재 객체 namespace에 아직 없는 생성만 허용 |
| editor / `constraint:<keys,indexes,checks,enums,tableRelations>:<id>` | 현재 owner와 collection/id를 확인해 structure patch 대상 선택 |
| editor / `delete:<tables,columns,keys,indexes,checks,enums,tableRelations>:<id>` | 현재 객체의 structure delete/review form 선택. 이미 삭제된 객체는 제외 |
| editor / `create:domain:project`, `edit:domain:<id>`, `delete:domain:<id>`, `move:domain:<tableId>` | domain create/edit/delete/move의 명시 초기 action와 대상 |
| editor / `advanced:index:<tableId>:<indexId 또는 new>` | NativeAdvancedEditor index target 또는 index:new |
| editor / `advanced:expression:<tableId>:check:<checkId 또는 new>`, `...:default:<columnId>`, `...:computed:<columnId>` | CHECK/default/computed target 선택. 새 CHECK는 check:new |
| editor / `canvas:placement:<viewId>` | 현재 nodeId/viewId/objectId가 맞는 배치 draft의 canvas view. domain view의 실제 shared placement는 __tables__ |
| editor / `canvas:action:<viewId>:<action>:<target>` | note/view 생성, note/view edit/delete, reference/remove-reference의 현재 target. personal view/화면 command는 canPersonalEdit 경로 |
| editor / `canvas:style:<table,domain,note>:<id>` | shared 카드/메모 스타일 초기 target. private note style 제외 |
| editor / `canvas:domain-relation:create`, `canvas:domain-relation:<edit,delete>:<id>` | domain 관계 초기 action/target |

- ID에 colon이 있어도 저장된 전체 producer key와 현재 ID로 비교한다. prefix를 임의 분해해 다른 객체의 retired/original ID를 주장하지 않는다.
- 삭제된 대상/부모 table/view/node, 이미 생성된 create ID, changed create ID, unknown key, clipboard 원문 생성/복사 key, 검증하지 못한 placement identity는 다운로드/명시 폐기만 가능하다. canRecover는 사본 생성 전에 최신 문서/권한을 재확인한다. 대상이 사라져도 원문을 지우거나 새 객체를 생성하지 않는다.
- 복구 사본은 원래 expected를 유지한다. 기존 stale/DB context 검사와 명시 compare/rebase가 적용되며 자동 저장하지 않는다. 개인 view가 아직 로드되지 않은 동안 공유 form으로 substitute하지 않는다.

## 동시 작업 staging / 남은 검증

- main 통합 재검증: archive/panel/routing/root/recovered forms/save/editor draft/domain9파일162개 통과. 현재 전체 web typecheck와 실제 web build도 통과했다. 공통 Canvas/Advanced 인터페이스는 선행 `fa7cf7f`/`2d92d85`로 분리돼 남은 archive writer·ACK·root routing 변경만 이 단위로 커밋한다. 실제 two-tab/계정·삭제 후 입력 복구 브라우저 QA는 계속 남아 있다.

- Hypatia 파일 `native-editor-structure.tsx`의 담당 hunk는 NativeStructureEditor.initialSelection `{action,target}`, 두 초기 state, details open이다. Hypatia의 AdvancedEditor import/렌더 연결은 보존했다.
- `NativeAdvancedEditor.tsx`의 담당 hunk는 initialSelection?: string, selected 초기 state, details open이다. root는 recovery epoch key와 `index:new`/`check:new`/JSON pair를 넘긴다. 사용자 충돌 확인 지시 후 이 파일의 추가 편집/전체 formatter는 멈췄다. 병행 C7 단위 `2d92d85`가 해당 초기 선택 interface를 포함해 커밋했고, 이후 별도 Prettier check 통과를 확인했다. 이 파일의 초기 interface는 이미 그 커밋에 있으므로 main에서 다시 중복 staging할 필요는 없다.
- Canvas/Domain/Style/DomainRelation에는 위 초기 선택 props와 private-view 대기 hunk만 담당한다. 그 외 C7/PNG/장식/UI 내용은 다른 단위의 변경이다. LAN test도 정확히 해당 crypto 사례만 담당한다.
- main이 common CanvasDecoration의 독립 staging을 위해 `native-canvas-recovery-types.ts`로 selection interface를 분리했다. archive target helper도 그 타입을 import/re-export해 중복 선언을 제거했다. Canvas는 archive writer/storage/routing에 의존하지 않는다. optional initial selection/private-view 대기는 common 단위에, root props mapping과 archive/routing은 후속 독립 commit에 둔다.
- 공통 타입 분리 반영 후 routing/root/form **3파일 76 passed**, strict targeted noEmit 및 helper Prettier 재확인 통과. root mapping/동작은 바꾸지 않았다.
- CanvasDecoration `fa7cf7f` 커밋 후 2026-10-02 18:17 KST 기준 재검증: targeted **22파일 298 passed**, 실패/skip 없음. root/helper/신규 tests와 두 LAN tests를 포함한 strict targeted noEmit 재실행 통과. parent가 확인한 전체 web types 통과와 자체 targeted 검증을 구분한다. 남은 담당 코드/테스트 17파일 Prettier 및 diff whitespace 검사 통과.
- 현재 독립 archive commit의 남은 범위는 다음 17 코드/테스트 + planning/work-log 2문서다: `native-draft-archive.ts/.test.ts`, `NativeDraftRecoveryPanel.tsx/.test.ts`, `native-durable-drafts.ts`, `native-editor-draft.ts`, `native-save.ts/.test.ts`, `project-ddl-export.ts`, `native-draft-recovery-target.ts/.test.ts`, `NativeProjectDraftRecovery.test.ts`, `native-recovered-forms.test.ts`, `NativeProjectView.tsx`, `native-editor-structure.tsx` 초기 selection hunk, `NativeDomainEditor.tsx` 초기 action hunk, `NativeDomainEditor.test.ts` LAN crypto hunk.
- Canvas optional initial selection/private-view 대기, standalone recovery type, style/domain-relation selection과 Canvas LAN test는 `fa7cf7f`에 포함되어 남은 archive commit에서 중복 staging하지 않는다. Advanced 초기 selection API는 앞선 `2d92d85`에 포함되어 있다. root props mapping, archive writer/storage/ACK/routing은 그대로 unstaged 상태다. 본 agent는 add/commit하지 않았다.
- 실제 두 브라우저 tab에서 동시 입력/reload/다른 tab ACK/삭제된 대상/계정 전환/저장소 실패의 end-to-end QA는 아직 하지 않았다. root 연결은 완료했으나 브라우저 QA는 main 인계 항목이다. 전체 pnpm check/build와 전체 AppModule QA를 본 단위 결과로 주장하지 않는다.
