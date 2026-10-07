# 비UI 저장 coalescing 계획 및 오너 통합 요구사항

## 목적과 담당 경계

로컬 입력과 이동은 UI에서 즉시 반영하고, 서버 전송 전에 연속된 최종 변경을 제한된 크기로 묶는다. 담당은 `native-save.ts`, `native-save-intents.ts`, 신규 pure helper와 테스트다. `use-native-autosave.ts`, `NativeProjectView.tsx`, `NativeERDCanvas.tsx`는 수정하지 않는다. 공유 작업 트리의 Git add/commit은 오너가 조정하며 이 비UI worker는 수행하지 않는다. 대상 코드 파일만 Prettier 처리한다.

## 조사 결과와 구현 경계

- `NativeProjectView`의 `saveWaiters`는 enqueue 시점의 pending 원문을 보관한다. enqueue 이후 request를 바꾸면 다른 탭 ACK 조회, durable fingerprint 및 서버 operationId/request hash가 일치하지 않는다.
- intent는 immutable localStorage 키, 전송 요청은 actor/project별 IndexedDB claim 및 transmission lease로 보호된다. 불확실한 전송은 ledger 조회와 취소 fence로 복구한다. rejected intent는 원문을 별도로 보존한다.
- 따라서 기존 intent 사이의 병합은 구현하지 않는다. 신규 helper는 operationId 생성 전 단일 제출 명령만 정규화한다. 별도 buffer/recovery 프로토콜 및 미연결 helper는 사용자의 후속 지시로 제외한다.
- enqueue 경로에만 단일 호출 안의 인접한 안전 patch를 최초 pending 생성 전에 정규화한다. 원본 명령을 모두 schema 검증한 뒤 정규화해 잘못된 중간 입력이 숨겨지지 않게 한다. `stageNativeSave`는 이미 저장된 기존 intent도 받으므로 정규화하지 않고 원문을 claim한다. 이미 저장/claim/전송된 pending에는 적용하지 않는다.
- 허용 명령: table/column의 logical name/definition 및 physical comment, node layout x/y/width/height. physical name/type/scope/customProperties와 나머지 명령은 경계다. 같은 명령 종류와 같은 대상의 인접 patch에만 last-write-wins를 적용하며 생략된 필드는 유지한다.
- 단일 제출의 원본 명령 수는 기존 wire 한도인 100개 이하로 검증한다. 서로 다른 enqueue/user/project/version/sequence/databaseRevision/draftRef 사이에는 병합하지 않는다. 중간 invalid 명령도 최종 valid 명령으로 숨기지 않는다.

## UI 오너의 연결 요구사항

1. 입력에서 로컬 표시와 기존 durable draft 보존을 먼저 수행한다. IME 미완성/invalid draft는 기존 복구 흐름으로 보존한다.
2. MAINBoyle(`01a11748-b6d4-7cc1-9d9b-fd149744572b`)가 기존 `useNativeAutosave`의 quiet window/deadline 정책을 연결한다. MAIN 전달 기준은 quiet 750ms/maxWait 2000ms이며, 비UI 파일에 중복 정책 상수를 두지 않는다.
3. 별도 buffer API는 추가하지 않는다. 최종 commands를 기존 `enqueueNativeSave(userId, snapshot, commands, expected, editorDraft)`에 한 번 전달한다. backend가 최초 pending 생성 전에 자동 정규화하므로 UI의 save API는 바뀌지 않는다.
4. 반환 operationId로 읽은 **실제 intent.pending** 및 기존 saveWaiters callback/Promise ACK semantics를 유지한다. 기존 intent를 변경하거나 caller를 debounce/로컬 저장에서 성공 완료하지 않는다.
5. canvasGodel(`01a11748-be17-78b1-92bb-cba9a8dcae50`)가 이동의 로컬 preserve/disk/frame coalescing/end 또는 debounce 제출을 담당한다. 다른 대상의 이동을 임의 재정렬하지 않고 하나의 최종 command batch를 전달한다.
6. MAIN/Godel이 연속 입력 및 이동 시 실제 요청 수 감소와 최종 값 보존을 UI 테스트로 검증한다. enqueue 후 전송 지연만으로는 서로 다른 intent가 합쳐지지 않는다.

## 검증

모델 적용 결과의 동등성, A→B→A 최종 값, 구조/delete/reorder 경계, 입력 불변성, invalid 중간 patch 및 100개 한도 차단을 검증한다. enqueue→stage→ACK 원문 일치, 전송 중 새 입력의 별도 intent 보존, 기존 전송/복구/rejected/draft 소비 테스트를 함께 실행한다. 네트워크 요청 감소는 UI 오너의 테스트 결과를 근거로만 보고한다.
