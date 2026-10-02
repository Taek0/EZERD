# Native durable queue·실패 draft 보존 작업 기록

- 계획: [NativeDurableQueue](../planning/2026-10-02-Database-NativeDurableQueue.md). 담당 queue/draft/blocker/API·targeted 검증 단위 **ready**. git add/commit/full check는 main 담당이다.
- 담당 외 NativeProjectView/history/format/structure/policy/private canvas 파일은 수정하지 않는다. main consumers 커밋 완료 안내 후 native-save 변경을 시작했고 기존 history pending guard를 보존했다.

## main async 연결 목록(API 확정)

- `native-save.ts`: `loadNativePending(...) → Promise<NativePendingSave|null>`, `stageNativeSave(...) → Promise<NativePendingSave>`, `discardNativePending(...) → Promise<void>`. 기존 인자 순서 그대로 유지한다. send/recover는 이미 async며 내부 durable row/전송 claim 검사까지 수행한다. draft load/store/discard는 sync API를 유지한다.
- `NativeProjectView.tsx`: pending 초기화 effect에서 await load + identity/unmount 보호; save에서 await stage 후 setPending/send; reset 버튼에서 await discard 후 상태 해제. IDB 실패는 empty로 취급하지 않는다. `useNativeDurableState` 또는 queue subscribe로 다른 탭의 pending/sending/unknown을 반영한다.
- `project-ddl-export.ts`: `assertNativeExportReady`의 loadNativePending를 await 하고 `assertNativeDurableReady`까지 await해야 한다. history/private pending도 공유 row로 차단한다. 이 helper의 App/NativeHistoryDialog/native-history와 관련 tests 호출도 await한다.
- App navigation/identity 전환은 `assertNativeDurableReady(uid,pid)` 및 기존 dirty/storageFailure blocker를 await/check한 뒤 적용한다. 폼 선택으로 unmount해도 실패 입력은 메모리에 유지되며 기존 export blocker는 해제되지 않는다.

## history/private canvas 공유 claim 사양(main 담당)

`getNativeDurableQueue()`는 같은 origin의 DB `ezerd-native-durable-v1`/store `pending`을 사용한다. scope는 JSON([actor,project])다. `NativeDurablePending`은 `{userId,projectId,operationId,kind,payload}`이며 kind는 commands/history/privateCanvas/upgrade다. upgrade는 format-v1 source도 같은 claim/lease를 사용하며 source version을 자동 변환하지 않는다.

1. history는 기존 Zod pending 전체를 `payload`, `request.operationId`를 operationId로 사용한다. private canvas는 pending 전체와 `revision`을 operationId로 사용한다. read 후 endpoint별 schema/identity를 검증한다.
2. 신규 stage는 `await queue.claim(entry, synchronousLegacyGuard)` 한다. 이전 localStorage pending이 있으면 immutable request 그대로 `claim(entry, guard, true)`로 import/adopt한다. 기존 `ezerd.native.history:[uid,pid]` 및 `ezerd.native.canvas.personal:[uid,pid]`는 migration evidence이며 같은 종류의 legacy 값만 adopt하고 다른 legacy kind/command pending이 있으면 차단한다.
3. shared queue claim 완료 전 POST를 보내지 않는다. `const token = await queue.beginTransmission(entry)` 성공 뒤 기존 실제 API request를 그대로 실행한다. 다른 탭/다른 kind는 동일 actor/project에서 pending/송신권을 얻을 수 없다.
4. 응답의 accepted ACK와 endpoint 고유 actor/op/group/database/sequence 또는 personal version/guard를 검증한 뒤 `await queue.acknowledge(entry, matchingDraftCleanup)` 한다. cleanup은 sync callback이고 현재 row의 payload fingerprint/operation/kind가 같은 경우에만 실행된다.
5. 전송 lease는 `{owner,token,expiresAt}`(기본30초)다. 전송 중 `renewTransmission(entry,token)`을 주기적으로 호출하고 `finally { await queue.endTransmission(entry,token) }` 한다. native command wrapper는5초마다 갱신한다. 다른 요청/이전 owner의 finalizer와 renew는 새 lease를 해제하지 않는다. transport 실패/ACK mismatch는 row와 원본 payload·uncertain 상태를 보존한다.
6. ACK lookup(GET)은 읽기이므로 기존 문맥에서도 확인 가능하다. 살아 있는 lease는 busy다. 만료된 lease는 **동일 kind/operation/payload fingerprint**에 한해 beginTransmission을 다시 허용하며 request/baseline/context를 새로 만들지 않는다. 서버 cached idempotency에 따른 동일 요청 재생이다. private canvas는 기존 personal version/context guard와 GET 후 동일 state 확인 규칙을 유지해야 한다. lease 만료나 end만으로 uncertain 결과는 확정되지 않으므로 새 stage/discard는 계속 차단한다. 검증된 terminal ledger rejection일 때만 `confirmRejected(entry)`로 uncertain을 해제할 수 있다. HTTP오류/GET404만으로 confirmRejected를 호출하지 않는다.
7. `queue.subscribe(uid,pid,listener)` + `queue.read/state` 또는 `useNativeDurableState`로 화면을 갱신한다. BroadcastChannel은 invalidation 알림만 보내고 pending 데이터/판정은 IDB에서 다시 읽는다. 브라우저의 active 구독은4초마다 read를 refresh하여 채널 부재와 lease 만료도 반영한다. Callback unknown→empty 판단은 IDB read 완료 뒤에만 가능하다. LAN HTTP를 위해 `nativeDurableId`는 getRandomValues 기반 UUIDv4이며 Web Locks/randomUUID를 요구하지 않는다.

테스트 injection: 기존 native-save `Storage` 인자는 legacy/draft 저장소이며 IDB 인자를 추가하지 않았다. `indexedDB` factory를 전역 주입하면 factory별 singleton이 분리된다. 두 연결은 `new NativeDurableQueue(factory,dbName,{now,leaseMs,ownerId})`로 생성하여 실제 transaction ordering/만료를 검증한다.

현재 history/private canvas consumer 파일은 main 담당이다. 이 공통 API 연결 전 해당 기존 localStorage writer와 새 command writer의 전역 exclusivity를 제품 완료로 주장하지 않는다.

## 구현 및 실패 입력 보존

- localStorage pending check/set을 신규 queue 저장 근거로 사용하지 않는다. native command pending은 IDB readwrite transaction에서 actor/project key 하나로 commit한 뒤에만 실제 API를 전송한다. readwrite durability는 strict다. history legacy guard 원본은 그대로 유지했고 private canvas legacy guard도 추가했다. 기존 command pending은 schema/actor/project/request 검증 후 동일 operation/group/client/baseline/context/commands로 adopt한다.
- transmission lease는 pending과 같은 row/transaction에서 변경한다. 30초 만료 후 동일 request 재생만 허용한다. token/owner/expiresAt 및 uncertain 상태는 내부 metadata며 payload는 immutable이다. 다른 operation/kind/payload를 새로 claim하거나 unknown pending을 discard하는 것은 만료 후에도 금지한다.
- 전송 실패·wrong ACK는 pending과 입력을 보존한다. 검증된 accepted ACK에만 matching operation/kind/fingerprint를 원자 비교해 consume한다. 과거 token의 end/renew와 ACK cleanup이 새 요청 row 또는 새 input revision을 지우지 않는다. 검증된 rejected ledger만 uncertain을 해제한다.
- draft는 sync API와 기존 localStorage 형식을 유지했다. localStorage 접근/parse/set/readback 전에 typed values를 메모리에 보관한다. quota, corrupt data, localStorage getter 거부 및 readback 불일치에도 현재 typed token과 expected epoch를 보존한다. 메모리 buffer는 Storage instance + actor/project/form별로 격리한다. default Storage getter가 막혔다 복구되는 경우에는 실패 buffer를 실제 Storage pool로 전달한다.
- failed buffer는 과거 persisted draft보다 우선해 reopen에 복구한다. 오래된 ACK는 다른 revision/values의 메모리를 없애지 않는다. 정상 retry가 완료돼야 storageFailure를 해제하며 reset은 remove/readback 확인 뒤에만 buffer를 지운다. 메모리만 보관된 입력은 browser close 이후 복구를 보장하지 않으므로 UI에 retry 안내와 beforeunload guard를 제공한다.
- `useNativeExportBlocker`에 선택적 다섯 번째 stable form identity를 추가했다. dirty/storageFailure entries는 unmount disposer가 지우지 않는다. matching input 소비 또는 명시 reset, 같은 identity의 clean 상태 갱신만 해제한다. 구 mount의 cleanup은 같은 identity의 새 failed entry를 지울 수 없다. basic property/editor form은 각각 `property:kind:id`/`editor:draftKey`를 사용한다.
- PropertyEditor와 EditorForm은 ref의 현재 입력을 보존하고 저장 응답 뒤 새로운 입력을 초기화하지 않는다. stale DB revision은 rebase하지 않는다. 저장 공간 재시도/명시 reset을 제공한다. gateflags 및 보호된 format/structure/policy/ProjectView/history/private canvas 코드는 변경하지 않았다.

## 검증 evidence와 main 후속 연결

- 초기 설치에 fake-indexeddb가 없어서 ignored `.data/native-durable-qa/package`의6.2.5로 검증했다. 이후 **main이 root devDependency와 lock에 fake-indexeddb6.2.5를 설치**했고 이 단위는 test helper를 필수 direct import로 전환했다. optional import/fallback/skip은 제거했고 dependency 부재는 test import 실패가 된다. peer 테스트 호환 availability 상수는 항상 true이며 dependency 부재를 숨기지 않는다. 제품에 memory-IDB fallback은 없다. 이 agent가 받은 scratch package/archive는 검증된 workspace 하위 exact directory만 재귀 삭제해 정리했다.
- `pnpm exec vitest run` 담당 native-save/native-durable-queue/native-editor-draft/native-export-state/native-actor-api **5개 파일52개 통과**, skip0. CI도 installed pinned package를 그대로 사용한다. 관련 native-editor-ui/option-policy까지102개가 통과한 뒤, main의 새 C7 expression 정책 반영 중 option-policy expectation2개가 이전 진단 코드를 기대해 최신 확장 재검증에서는100/102 통과했다. 담당5개 파일은 scratch 제거 뒤에도52/52 통과했다. 보호된 option-policy tests는 변경하지 않았다.
- 두 factory connection에서 command/history/privateCanvas 동시 claim 1승자, immutable payload, transmission1승자/실제 transport callback1회, 늦은 finalizer, actor/project 격리, transaction abort, connection close/reopen, 실제 BroadcastChannel invalidation을 확인했다. fake-indexeddb의 실제 IDB API/transaction ordering을 사용했고 store methods를 Map으로 mock하지 않았다.
- crash lease QA: A connection claim+begin 후 close → B connection이 만료 전 busy, 만료 뒤 동일 operation/payload만 재획득; 새 history request 및 unknown discard는 거부; A의 old end/renew가 B의 새 lease에 영향을 주지 않음. native API recovery GET404→POST에서도 기존 operation/group/client/context/commands가 그대로 replay돼 accepted ACK 후 clear됨을 확인했다.
- typed input quota/read/getter failure와 reopen/retry/reset, unknown storage write 거부, 불완전 token 보존, beforeunload 실제 Event 취소, unmount stable blocker 및 새 form identity 보호를 확인했다.
- apps/web tsconfig의 동일 compilerOptions로 담당14개 파일 + 실제 import dependencies를 TypeScript program으로 검사: **통과**. 전체 web typecheck는 같은 시점 main/타 agent의 진행 중 async history/upgrade/transfer 연결 오류로 실패했으며 담당 source/test 오류는 없었다. 앞선 DomainEditor 테스트 오류는 main의 병렬 작업 상황으로 기록했다.
- main 연결 중인 history/DDL tests는 async await·IDB factory 주입 변경이 필요했다. 읽기 확인 당시 Canvas SSR2개는 4인자 mock expectation을 stable identity의5인자로 갱신해야 했다. 담당 외 테스트를 직접 수정하지 않았다. 최종 full check는 main이 담당한다.
- 최종 담당14개 파일 루트 Prettier check 및 tracked 변경 diff whitespace check, 두 문서 상대 링크 검사 모두 통과했다. Node IDB tests는 root 설치6.2.5 direct import이며 ignored scratch 삭제 뒤 검증했다.
- main의 shared claim legacy/draft guard에는 `nativeDraftMemoryState(uid,pid,storage).storageFailure` 또는 global `nativeEditorStorageFailed`를 포함한다. history/private queue payload를 만들 때 기존 schema, scope/context, legacy evidence guard를 유지하고 새 epoch/request로 자동 rebase하지 않는다. `nativeDurableId`도 HTTP LAN에서 UUID 생성이 필요한 보호된 consumer에 연결한다.

## Actor-bound default API(후속 보완 완료)

`native-actor-api.ts`의 `captureNativeActorApi(userId, api=request, options?)`를 **첫 await 전에** 호출한다. 반환된 API를 baseline/stage 후 실제 전송/GET/동일 요청 재생에 계속 사용한다. options의 sessionStorage/fetcher는 테스트 injection이다. 명시 injected API는 호출자가 actor-bound 권한을 보장하는 것으로 취급한다.

- root rg 결과 실제 sessionStorage `ezerd.sync.session` 형식은 App이 쓰는 `{userId,token,expiresAt,baselineIssuedAt}`다. 기본 helper는 pending userId와 이 userId를 비교한다. user.id가 함께 있는 경우에도 모순을 거부하며 actor 미상/expired/읽기 실패는 fail closed다.
- Authorization은 캡처된 actor session의 closure 안에만 있다. queue/draft/payload에 token을 넣지 않는다. 매 API 호출 및 실제 fetch 직전에 current userId/token/expiry가 캡처 값과 같은지 검사하고, shared client의 live auth와 caller headers보다 캡처 Authorization을 우선한다. fetch 직전 검사와 fetch invocation 사이에는 await가 없다.
- native-save send/recover는 IDB await 전에 helper를 캡처하고 GET404 후 replay에도 동일 helper를 전달한다. 따라서 stale pending을 NEW actor의 현재 Authorization으로 보내지 않는다. ACK 후 actor/project UI active guard는 별도로 유지해야 한다.
- 테스트: wrong actor/default session 부재·만료·storage 거부, await 후 actor/token 변경, shared client live auth 조회 시 계정 변경, Headers/object/tuple Authorization override, 실제 default send의 캡처 Authorization·immutable request 및 credential 비저장, GET404→계정 변경 후 POST0회를 확인했다.
- history/private/upgrade 소비는 main이 이 helper를 import하여 첫 await 이전 캡처를 적용한다. 서버의 project-lifetime cancellation/rejected ACK 마커는 main/Singer 범위며, HTTP404만으로 uncertain을 해제하지 않는다.

## 최종 전달

- 메인 통합: required root dev dependency `fake-indexeddb@6.2.5`와 lockfile을 고정해 test runtime의 optional skip/scratch fallback을 제거했다. queue/명령/draft/actor/history/export 7개 파일 64개가 skip 없이 통과했다. 현재 working tree의 전체 web typecheck도 통과했다.
- history는 같은 IDB row/송신 lease/heartbeat를 사용하며 최초 await 전에 actor를 고정한다. HTTP 오류나 ledger 404는 요청을 해제하지 않는다. async export guard는 모든 durable kind와 failed-memory draft를 확인하고 동일 guard를 claim transaction 안에서도 다시 사용한다. App export 호출과 native root의 load/stage/discard 및 늦은 응답 보호를 async로 연결했다.
- 도메인 UI 변경은 root의 async 저장 소비에서 분리 스테이징했다. 실제 브라우저 two-tab QA, private canvas 소비, 전용 cancellation marker의 UI 연결 및 orphan/cross-tab draft 복구 확장은 후속이다. 준비 API/Node IDB 테스트를 브라우저 성공으로 계산하지 않는다.

담당 정책/API·보존·lease·actor 검증 단위 ready다. root fake dependency는 main의 변경이며 이 agent는 package/lock, NativeProjectView/history/private canvas/upgrade/format/structure/policy/UI tests 및 server cancel 코드를 수정하지 않았다. main은 consumer 통합/실제 브라우저 two-tab QA/full check/git add·commit을 담당한다. 동일 request lease replay와 v1 upgrade 상호배제는 필수 Node IDB tests로 확인했다. gateflags와 legacy 원본은 변경하지 않았다.
