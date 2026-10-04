# Native private canvas web durable·revision 저장 구현

2026-10-02. [계획](../planning/2026-10-02-Database-NativePrivateCanvas.md)에 따른 독립 web 단위다. 변경은 신규 native-private-canvas.ts/tests, NativeERDCanvas.tsx의 개인 저장 분기 및 기존 private helper callsite 테스트다. NativeProjectView/server/contracts/기존 queue/actor-api/cancellation/model gate는 수정하지 않는다. 새 dependency와 git add/commit은 없다.

## API 및 저장 의미

- `loadNativePrivatePending(actor,project,options?)`: 반드시 IDB read 후 privateCanvas row만 반환한다. 기존 localStorage 개인 pending은 동일 payload로 uncertain adopt한다. 조회 자체가 새 전송이나 unknown 해제가 아니다.
- `stageNativePrivateCanvas(actor,snapshot,personal,candidate,options?,editorDraft?)`: 원본 native source와 개인 state를 검증하고 actor/project row를 transactional claim한다. old command/history LS request도 새 private claim 앞과 transaction guard에서 검사한다. 새 ID는 HTTP LAN에서도 getRandomValues를 사용한다.
- `sendNativePrivateCanvas(pending,snapshot,options?,api?)` / `recoverNativePrivateCanvas(pending,snapshot,allowReplay,options?,api?)`: 동일 row의 lease/heartbeat를 확보한 후 최신 개인 snapshot을 GET하고, 기존 version/before state/DB revision/project version/sequence가 모두 같을 때만 동일 PUT을 보낸다. `options={storage?,queue?}`는 테스트 injection이며 기본은 실제 localStorage/IndexedDB다.
- `discardNativePrivatePending`: 전송 전 known pending만 reset 가능하다. uncertain/active lease는 기존 queue가 거부한다. 다른 operation/payload를 제거하지 않는다.
- `readNativePrivateCanvas`: actor를 첫 await 전에 capture하고 실제 응답 databaseRevision을 요구한다. raw actor credentials/token을 payload에 저장하지 않는다. default API는 같은 actor session을 real fetch 직전에도 검증한다.
- `nativePrivateCanvasGuardAvailable`: bundled contracts에 기대 DB/project/sequence guard 및 response DB revision이 있어야 쓰기 UI가 켜진다. zod를 web에 직접 import하지 않고 기존 contracts snapshot schema를 재사용한다. DB revision 정수 검사는 얇은 adapter에 둔다.

REST 개인 PUT은 기존 서비스의 `expectedVersion` CAS이며 operation ledger/ETag/idempotency key가 없다. pending.revision은 로컬 durable identity다. 직접 PUT 응답은 정확한 next version/target state/DB 및 공유 revision context가 일치해야 소비한다. GET의 **정확한 expectedVersion+1 및 동일 target state**는 별도의 observed CAS postcondition 확인이다. 이는 자신의 operation ACK를 찾았다는 뜻이 아니며, CAS가 이미 소비돼 늦은 동일 expectedVersion PUT이 재적용될 수 없다는 의미다. 이 제한된 확인만 matching row와 captured draft를 소비한다. 더 높은 version/다른 state/단순 HTTP404·409는 성공 ACK로 취급하지 않는다. unknown을 임의 reset하거나 cancel_native_request에 private PUT을 넣지 않았다.

## Canvas 연결과 main props

개인 stage/load/discard helper를 async로 전환했다. Canvas가 await하고 queue subscription으로 다른 tab의 pending/sending/unknown/empty를 읽는다. unknown→empty는 실제 read를 거친다. 다른 tab이 pending을 마치면 개인 snapshot도 새로 GET한다. 빠른 재렌더/actor/project/shared version/sequence/DB revision 변경 및 unmount 뒤 응답은 identity guard로 UI 상태를 덮어쓰지 않는다. matching pending revision만 UI에서 clear하며 새 pending은 유지한다.

개인 candidate는 reader preview가 아닌 `snapshot.sourceDocument`에 reconciled 개인 state를 merge한 원본에서 만든다. reader-generated 공유 배치/타입/default를 개인 저장으로 전달하거나 바꾸지 않는다. 실제 PUT body에는 개인 state만 들어간다. typed draft 저장 실패는 메모리에 남기고 stage를 막는다. delayed matching 결과는 더 새로운 draft revision을 제거하지 않는다. unknown reset 버튼은 비활성이다.

NativeProjectView는 수정하지 않았다. 기존 props로 actor/context/queue 연결은 동작한다. 추가 optional prop:

```tsx
<NativeERDCanvas
  {...existingProps}
  personalEditable={!!userId && workspaceIsActive && snapshot.project.status === 'active'}
/>
```

server WorkspaceAccessService의 `personal`은 active workspace의 viewer도 허용하므로 shared `canEdit`와 분리할 수 있다. personalEditable 생략 시 기존 editable을 사용한다. 공유 입력/clipboard 권한은 기존 editable을 유지하고 viewer가 private action을 열어도 shared save는 차단한다. main이 실제 workspace permission을 기준으로 이 prop을 연결해야 한다. ProjectDocumentState에는 이미 shared version/sequence/DB revision이 있어 새 identity props는 필요 없다.

## main backend 계약: 현재 준비와 실제 활성화의 차이

작업 중 읽은 PersonalStateController는 PUT에서 expectedVersion/state만 소비했고 PersonalStateService GET에는 databaseRevision이 없었다. 따라서 그 서버로 private 쓰기를 활성화하지 않았다. backend/contract 변경은 main 범위이며 다음을 일치시켜야 한다.

```ts
// GET/PUT response
{ version, projectVersion, syncSequence, databaseRevision, state }
// PUT
{ expectedVersion, expectedDatabaseRevision, expectedProjectVersion, expectedSyncSequence, state }
```

서버는 project lock 아래 source schemaVersion/native context, databaseRevision, project.version, project.syncSequence 및 actor의 개인 version을 검사한 뒤 state를 저장해야 한다. REST body에 operationId를 추가하거나 기존 MCP operation ledger로 PUT을 오인하지 않는다. MCP apply_personal_changes도 DB/shared context guard를 별도로 소비해야 한다. private 저장 자체는 shared project version/sequence를 늘리지 않는다. matching 직접 응답의 context를 그대로 돌려준다. 구 v1 호출 지원 정책/optional fields 여부는 main이 구독자 테스트와 함께 결정하되 native web PUT은 모든 기대값을 보낸다.

현재 web 분기·helper는 이 wire에 연결돼 있다. main 후속 backend source에서 컨트롤러→service context 전달, project lock 뒤 native context-required/triple 비교, 개인 CAS 및 native response DB revision 반환을 읽어 확인했다. optional fields가 추가된 contracts barrel build도 통과했고, default actor-bound 실제 request 함수→fetch boundary를 사용한 client test가 통과했다. 실제 endpoint의 DB-backed PUT/브라우저 QA는 main 단계다. schema.shape만 존재하는 것으로 서버 구현이나 실제 저장 QA 완료를 주장하지 않는다. main은 stale context rejection integration test 및 context 없는 MCP trusted callback 조건을 최종 확인해야 한다. 구 서버의 읽기는 계속 표시할 수 있으며 guard/응답 DB revision이 없으면 개인 쓰기를 차단한다.

## 검증

- main 통합: native 개인 문맥 서버/계약은 `a99259c`로 완료했다. root는 workspace personal 권한을 별도로 canvas에 전달하여 viewer의 개인 저장을 허용하고 shared 편집 권한과 구분한다. private helper/canvas/queue/actor4파일59개 및 root/view async12개 통과. 실제 브라우저·최신 빌드 개인 저장은 BrowserPathQA에서 검증한다. uncertainty의 CAS-precondition 소멸 후 명시 복구 UX는 별도 후속이다.

- 실제 fake-indexeddb6.2.5 두 연결에서 actor/project claim race와 commands/history/upgrade 배제, crashed persisted lease 재개 및 old token end fencing을 검사했다. dependency를 skip하지 않는다.
- 공유 request transport의 실제 captureNativeActorApi를 사용해 GET await 뒤 session actor 변경 시 PUT fetch가 발생하지 않음을 검사했다. auth/token은 durable payload에 없다.
- guarded PUT fields, matching direct response, lost response 뒤 GET observed postcondition, archive read-only confirmation, malformed/wrong context response, stale personal/shared/DB revision, pre-IDB legacy writers, storage denied 및 failed typed draft/newer draft 보존을 검사했다.
- private helper/NativeERDCanvas/core queue/actor-api 4파일 **59 tests passed**. 기존 Canvas private callsites도 async/DB revision/fake IDB로 갱신했다. optional triple fields가 있는 새 barrel에 default GET→PUT 전송과 Authorization pin/guard body parse를 검증했다.
- web typecheck는 연결 직후 통과했다. 이후 다른 agent WIP native-advanced-policy.ts 오류는 수정됐고 마지막 full web 검사에는 다른 agent NativeCanvasStyleEditor.tsx command type 오류만 있었다. 해당 파일은 수정하지 않았다. private helper/tests의 strict dependency typecheck(`tsc --ignoreConfig --noEmit ...`)는 최종 통과했다. 담당4파일 Prettier check 통과 및 Canvas tracked diff whitespace check 통과다.
- 지정 파일 root Prettier 적용. docs는 루트 .prettierignore 대상이다. full build/check/실제 browser 저장 QA와 commit은 main 담당이다.

별도 새 작업을 시작하거나 server/NativeProjectView/queue/cancellation을 편집하지 않았다.

## 실제 브라우저 후속 검증 (core commit 이후)

2026-10-02 전용 loopback3141 API와 자체 UUID DB `ezerd_private_browser_f859b9ae07124c3285e7987526a722ab`에서 QA owner/PIN으로 정상 UI 로그인했다. 개인 카메라 120% 저장 후 재조회·프로젝트 reopen에서 복구를 확인했고, 공유 도메인 생성 뒤 개인 뷰 `Private Flow View`를 실제 guarded PUT으로 저장했다. 최종 실제 SQL 및 actor-bound REST GET은 personal version2, project version1, sequence1, databaseRevision0, 뷰1개 및 zoom1.2를 반환했다. 개인 저장 두 번이 공유 version/sequence/DB revision을 변경하지 않았다. sanitized 실제 GET/SQL 결과는 `.data/native-private-live-evidence.json`에 남겼다.

실제 폼에서 full NativeEditorDraft가 구조적으로 DraftRef에 전달되어 strict pending parse가 extra fields를 거부하는 문제를 발견했다. helper의 pending.editorDraft를 정확히 key/revision 두 필드로 정규화하고 회귀 테스트를 추가했다. actor bound default GET/PUT 테스트 및 private/Canvas/queue/actor targeted는 기존59에서60개로 증가했다. 수정한 Vite bundle을 실제 API에서 소비하여 뷰 생성 성공을 확인했다. gate/계약/원본은 변경하지 않았다. core commit 이후 corrective diff는 이 helper/test 두 파일뿐이며 Canvas 후속 직접 수정은 하지 않았다.

초기 PNG가 HMR/scroll 때문에 저장 상태를 제대로 보여주지 않아 성공 증거로 사용하지 않았다. 새 owned UUID DB `ezerd_private_browser_80c25e563df44af79a2b2979f4d9b429`와 static3141에서 QA Private Visual Evidence를 생성하고 카메라120% 저장→reload→reopen을 다시 수행했다. 이때 실제 복구된120%를 보이는 `.data/native-private-camera-live.png`를 캡처했다. 잘못 캡처한 view PNG는 제거했다.

두 backend QA listener와 owned UUID DB는 확인 후 harness의 stop/finally로 제거했다. own Vite3142 child도 workspace path/정확한 startup args/PID를 검증한 뒤 종료했다. 사용자 DB/부모 QA DB는 수정하지 않았고 auth credential은 증거 파일·로그에 남기지 않았다. own 임시 script/config를 제거했다. CAS-precondition 소멸 후 보관/명시 해제는 별도 [계획](../planning/2026-10-02-Database-NativePrivateCASProof.md)이다.
