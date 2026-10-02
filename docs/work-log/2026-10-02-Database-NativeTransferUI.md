# Native 전송·업그레이드 UI 작업 기록

- 계획: [NativeTransferUI](../planning/2026-10-02-Database-NativeTransferUI.md).
- 상태: 담당 소비 단위 **ready**. App 및 병렬 서버/model/contracts/durable 계층은 수정하지 않았다. 전체 check/build, browser 조작, git add/commit은 하지 않았다.

## 구현

- `project-transfer.ts`는 기존 format1과 compact/full format2 reader를 함께 검증한다. 원본 JSON UTF-8 2MB 및 계약의 각 문서1.5MB 예산, DB/profile 일치, 전체 source/preview graph·AST 참조를 검사하고 검증된 원문을 반환한다. v2를 v1로 투영하거나 legacy evidence를 normalize하지 않는다. source unavailable 백업은 읽지만 신규 import는 사유를 표시하고 차단한다.
- import는 이름만 바꾸며 project DB/profile metadata를 보존한다. v1 endpoint는 기존 그대로 사용하고 v2는 native-transfer endpoint 및 전체 import result/Project 계약을 사용한다. 응답의 target workspace, DB kind/profile/revision metadata를 확인한다. 등록된 정책의 사용 가능 상태를 클라이언트가 승격하지 않으며 서버403/진단 응답을 그대로 실패로 취급하고 선택 파일을 보존한다.
- export는 최신 document-state의 source 형식으로 기존 v1 export/native-transfer를 선택한다. 원래 source, version/sequence/revision/profile/name을 파일 및 재조회 snapshot과 비교한다. 동일 head 상태와 첫/마지막 async durable guard를 통과한 뒤에만 Blob/link를 생성한다. scope/account/token 변경·unmount는 결과를 버린다. format1 비교만 기존 서버 normalization+계약을 사용한다.
- 공통 `captureNativeActorApi`를 import/export/upgrade에 적용했다. 실제 session userId/token/expiry를 첫 await 전 검증·고정하고 매 실제 fetch 직전에 검사한다. session actor 변경은 parent props 갱신 전에도 다운로드/apply를 차단한다. 토큰은 closure에만 있고 IDB payload에는 없다.
- `NativeUpgradeButton`은 검토와 실행을 나눈 명시 control이다. 최신 v1 저장 상태를 조회한 뒤 DB/profile, legacy migration 진단, baseline invalidation과 원문 보존을 설명한다. v1 autosave prepare 실패, source/head 변경, 일반 readonly/archive 쓰기는 stage 전에 차단한다.
- `native-upgrade.ts`의 prepare/stage/load/send/reload는 공통 `getNativeDurableQueue`의 실제 upgrade kind를 사용한다. actor/project 하나의 IDB row에 검토 snapshot과 원래 POST input을 저장하고 claim 안에서 scope 및 동기 legacy/draft guard를 검사한다. 다른 commands/history/privateCanvas와 원자 상호배제한다.
- send는 같은 persisted payload만 읽고 lease를 확보한 뒤 전송하며5초 heartbeat를 유지한다. actor/op/group, expected sequence+1/revision+1, DB/profile, baseline 및 전체 ACK 문서를 검증한 accepted/document.upgraded 결과만 exact row consume한다. HTTP오류, 잘못된 ACK, scope 변경, 불명확한 결과는 원문과 operationId를 보존한다. reopen/retry는 새 permission/prepare/context를 만들지 않고 같은 요청을 재생해 viewer/archive의 과거 ACK 확인을 지원한다.
- ACK consume 뒤 최신 state 읽기가 실패하면 완료 receipt와 재조회 control을 제공한다. 완료 ACK를 다시 POST하지 않는다. 현재 head의 DB revision이 다른 경우 자동 context 전환은 승인하지 않는다.

## main 필수 연결

1. App v1 공유 메뉴에 `NativeUpgradeButton`을 연결한다. 필수 props는 `userId/projectId/workspaceId/canUpgrade/prepare/onUpgraded`; prepare는 v1 autosave/prepareToLeave 완료를 기다려 boolean을 반환하고 onUpgraded는 최신 ProjectDocumentState로 versioned/native 화면과 metadata를 갱신한다. 재생 control은 canUpgrade=false라도 같은 actor의 read 권한으로 사용할 수 있다.
2. Gallery에 userId를 넘기고 `onExport(project, control)`의 두 번째 인자를 `exportProjectFile(project.id, {control})`로 전달한다. App의 기존 v1/native 공유 export 호출도 live actor/project/workspace control을 전달해야 화면/프로젝트 전환을 검출한다. 기존 인자만 사용하는 fallback은 session actor는 보호하지만 App의 현재 열린 프로젝트를 알 수 없다.
3. 공통 durable queue의 upgrade union/validator 및 actor API 공개가 선행되어야 한다. 이 단위는 준비된 실제 API를 소비했으며 해당 파일은 수정하지 않았다. 전체 navigation/export blocker는 main이 유지한다.
4. Singer의 native-upgrade unknown cancellation marker와 main UI의 취소 연결은 후속이다. 이 단위에는 unknown discard/reset 또는 HTTP403/404만으로 confirmRejected하는 경로가 없다. UI는 같은 요청 재생만 제공한다.

## 검증과 범위

- helper/static 전용 tests는 실제 공개 계약·migration 모델과 fake-indexeddb의 실제 IDB API/transaction ordering을 사용한다. policy/source parser를 mock하거나 coverage flags를 위조하지 않았다. API 응답 fixture는 클라이언트 검증용이며 서버 integration/실제 DB 업그레이드 실행으로 주장하지 않는다.
- 세 DB의 compact/full format2·v1 source raw alias/legacy 진단, index/check/AST 보존, 손상 참조/context/전체 metadata, import rename/workspace/403 응답, fresh export 좌표·scope 변경과 async durable guard를 검증했다.
- 실제 IDB의 upgrade/history 두 connection 동시 claim1승자, 모든 다른 writer 차단, lease 동시 전송1POST·heartbeat, reopen exact replay(viewer/archive fixture), malformed payload, wrong actor/op/group/sequence/revision/profile/baseline ACK 보존, accepted consume 후 reload 실패를 검증했다. readonly/static control·legacy 설명·native 객체 수를 확인했다.
- 최종 담당 Vitest5개 파일: **59개 통과, skip0**. 담당11개 구현/테스트 파일 및 기존 Gallery test와 실제 import dependencies를 web tsconfig compilerOptions + Vite ambient로 검사한 TypeScript program: **diagnostics0**. targeted Prettier write/check 통과. browser/full check/build는 수행하지 않았으며 main이 담당한다.

## 변경 파일

- 메인은 v1 프로젝트 본문에 명시 업그레이드 검토 버튼을 연결했다. 새 검토는 기존 autosave/pending/storageFailure 확인을 완료해야 시작하며 accepted 뒤 현재 actor/project가 동일할 때만 versioned 프로젝트를 다시 연다. share export/import·갤러리 전송은 저장 source 버전을 기준으로 선택한다. 5개 helper/static 테스트 59개가 통과했으며 실제 파일 다운로드/업그레이드 브라우저 QA는 후속이다.

- `apps/web/src/features/projects/ProjectTransfer.tsx`, `project-transfer.ts`, `project-transfer.test.ts`, `project-versioned-export.ts`, `project-versioned-export.test.ts`, `ProjectGallery.tsx`.
- 새 `NativeUpgradeButton.tsx`, `NativeUpgradeButton.test.ts`, `native-upgrade.ts`, `native-upgrade.test.ts`, 테스트 공유 helper `native-transfer-test-fixtures.ts`.
- 이 작업 기록 및 [계획](../planning/2026-10-02-Database-NativeTransferUI.md). 기존 ProjectGallery.test.ts는 변경하지 않고 검증만 했다.
