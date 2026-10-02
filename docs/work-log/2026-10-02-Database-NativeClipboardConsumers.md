# Native clipboard 실제 소비 결과

- 작성일: 2026-10-02
- 계획: [NativeClipboardConsumers](../planning/2026-10-02-Database-NativeClipboardConsumers.md).
- 기준 main 단위: DomainUI `4336f94`, Core queue `9657dd8`. 검증 시 다른 담당 변경은 그대로 유지했다.
- git add/commit 및 progress 수정, 전체 format/check/build는 수행하지 않았다. main이 범위를 확인하여 커밋한다.

## 변경 파일

- Web 신규: `apps/web/src/features/projects/native-clipboard.tsx`, `native-clipboard-helpers.ts`, `native-clipboard-test-fixtures.ts`, `native-clipboard.test.ts`, `native-clipboard-interaction.test.ts`.
- Web 연결: `NativeERDCanvas.tsx`, `NativeERDCanvas.test.ts`.
- 계약/기존 C2 helper: `packages/contracts/src/native-clipboard.ts`, `native-editor-command.ts`, `native-editor-command.test.ts`.
- 실제 renderer: `apps/server/src/mcp/mcp-native-document.service.ts`; 새 테스트 `apps/server/test/native-clipboard-command.test.ts`, `native-clipboard.integration.test.ts`.
- 이 단위 계획/결과 문서. public index, model/validation/typeflags/index-policy, App/NativeProjectView 및 NativeSync/History/Upgrade는 편집하지 않았다.

## 실제 연결

- Canvas 메뉴에서 native 테이블을 선택하고 source snapshot의 `sharedDocument` 및 공통 canonical layout helper를 거쳐 기존 C2 copy helper로 format2 fragment를 만든다. 개인 view/note/camera를 제거하며 없는 canonical geometry는 복사 준비에만 사용한다. 원본을 저장하거나 v1/SQL 타입으로 투영하지 않는다.
- 객체별 수와 선택하지 않은 FK endpoint 때문에 생략된 관계 이름을 표시한다. OS Clipboard API 사용 버튼과 manual JSON textarea를 모두 제공한다. LAN HTTP에서 API가 없거나 거절되면 수동 복사/붙여넣기로 계속할 수 있다.
- UI의 paste는 DB/profile·목적 domain/좌표·이름·ID remap·진단을 검토하고 실제 NativeEditorForm→기존 root onSave→durable native-save/command route로 전달한다. dirty/storageFailure/export blocker, expected version/seq/rev와 matching draft ACK를 기존 form에서 소비한다.
- paste raw/review text와 remap은 100,000자 이하 draft field 80개로 분할하여 기존 field/record 계약 안에서 보관한다. 임의 digest 대신 검토 원문/remap의 정확한 일치와 저장 문맥을 확인한다. 수정/목적지/좌표/버전 변경은 검토를 무효화한다. 새 ID는 `nativeDurableId(getRandomValues)`로 만들고 검토 뒤 고정하여 전송/복구에 같은 목록을 사용한다.
- 늦은 기기 clipboard read는 이미 수정한 입력이나 unmount된 actor/project form을 덮지 않는다. copy 완료 알림도 캡처한 actor/project/revision 화면에만 반영한다.

## 계약과 서버 정책

- 새 `paste_native_clipboard` 명령은 strict format2 envelope, nullable domainId, bounded point, 객체/node 수와 일치하는 unique fresh UUID 목록을 받는다. clipboard 원래 ID와 동일한 새 ID, 누락/중복 remap, unknown field/privilegedBefore/existing bind 입력을 거부한다.
- 기존 clipboard envelope에 optional `sourceProjectId`를 추가했다. 필드 없는 원문도 읽을 수 있다. copy helper의 네 번째 optional 인자는 sourceProjectId이며 기존 호출은 그대로 작동한다. 이 메타데이터는 source 프로젝트 조회 권한, trusted previous 또는 기존 객체 bind 권한을 부여하지 않는다.
- live 명령은 모든 참조를 fragment 내부에 포함해야 하며 외부 table/column/ENUM short ID에 자동 연결하지 않는다. ENUM도 새 ID로 복제하고 이름 충돌은 기존 C2 정책으로 처리한다. C2 helper의 기존 ENUM 재사용은 마지막 optional `reuseEnums` 옵션으로 유지하되 live에서 false로 설정한다. 같은 프로젝트라 하더라도 이번 단위에서 existing bind는 제공하지 않는다.
- 기존 `planNativeTablePaste` 및 model remap을 재사용한다. table/column/key/FK/index/check/ENUM/노드·route AST 참조를 함께 remap하고 큰 숫자 literal token과 native namespace/default/generation/options를 보존한다. logical scope에도 legacy 원문은 신규 복제하지 않는다.
- 동일 DB/profile, envelope·명령 UTF-8 2MB, 최종 문서 1.5MB, 스키마 객체/AST/layout 한도와 ordinary 1,000-change budget을 검증한다. 한도를 넘는 fragment를 자르지 않으며 검토 진단으로 차단한다.
- 실제 MCP native renderer 분기와 SDK metadata에 type을 추가했다. baseline/batch occupied claims에 모든 새 entity/node ID를 남기며 persisted retired ID는 기존 locked sync가 거부한다. replay-before-validate/row lock/fresh design 권한/ordinary validation은 그대로 유지한다. physical usable/coverage flags는 변경하지 않았다.
- 공개 API는 기존 native-edit 및 native-clipboard barrel로 노출되어 별도 index 파일 추가가 필요 없다. dist는 main shared build가 갱신하며 이 단위 검증은 최신 source alias를 사용한다.

## 검증

- source alias Vitest targeted 7파일 **70개 통과**, skip 없음: 새 clipboard helper/menu 12개, UI callback 3개, 실제 renderer/MCP handler 6개, editor 계약 10개, 기존 C2 준비 10개, 기존 native command 6개, canvas 23개.
- UI callback 테스트는 DOM 없는 hook driver로 실제 메뉴·form callback을 실행한다. manual copy, 검토 없이 onSave 미호출, 고정 native 명령 전달, 늦은 ACK 뒤 최신 draft revision 보존 및 늦은 clipboard read 취소를 확인했다. static UI는 readonly/archived copy 메뉴와 pending paste 비활성을 확인한다.
- 테스트 IndexedDB와 실제 native-save helper로 remap을 보관한 뒤 전송함을 확인했다. ACK 유실 후 readonly/DB revision 변경 상태에서 옛 ACK 조회만으로 matching pending을 소비하고 더 최신 clipboard 입력은 남는다. 해당 transport는 mock이다.
- disposable 로컬 `ezerd_qa_*` DB에서 migrations 후 최신 소스 AppModule를 실제 실행한 REST/MCP 테스트 **7개 통과**. 세 DB logical graph 실제 저장/원문 token·FK/check remap/ACK 재생, 등록된 MCP paste 성공, legacy/foreign DB/미해결 borrowed FK 거부, 삭제 뒤 persisted ID 재사용 ACK rejection, batch 재사용 거부와 viewer 권한 거부를 확인했다. DB·프로젝트/사용자 fixture는 격리 runner/테스트 cleanup으로 정리했다.
- 현재 coveragefalse 물리 paste는 실제 renderer ordinary policy에서 차단됨을 단위 검증했다. 물리 DDL/DB 실행 성공이나 전체 native 완료를 주장하지 않는다.
- 담당 web/계약/서버와 transitive 최신 source의 scoped noEmit typecheck 통과. changed-file Prettier 및 diff whitespace 검사를 완료했다. 최종 재실행도 targeted 70개와 격리 실제 REST/MCP 7개 모두 통과했다. 실제 browser QA는 수행하지 않았다.

## main 인계 및 남은 제한

- main 통합: root는 durable stage 첫 await 전에 actor transport를 고정하고 실제 송신에 넘긴다. 같은 actor의 session token이 staging 동안 교체되면 네트워크 요청 없이 pending을 보존하는 회귀 테스트를 추가했다. main targeted 6파일64개 통과 및 shared build 통과. 후속 agent 단위와 분리하여 커밋한다.

- actor pin 인계: 이번 scope 밖인 `NativeProjectView.save`는 stage IDB await 전에 `captureNativeActorApi(userId)`를 캡처하고 `sendNativePending(staged, localStorage, actorApi)`에 넘겨야 같은 actor의 세션 교체도 pre-stage 기준으로 확인한다. 현재 sender는 자기 첫 await 전에 pin하며 root는 actor/project 세대를 확인하지만 root stage 전 세션 캡처는 main 연결 확인이 필요하다. 이 요청을 main에 알렸고 View 파일은 수정하지 않았다.
- main shared build/index 점검과 browser/LAN QA: 실제 메뉴 위치, 다중 선택/partial FK 안내, copy 권한 거절 시 수동 textarea, review/reset/stale/저장 ACK와 actor/session 전환을 확인해야 한다.
- optional sourceProjectId는 미인증 출처 설명이다. 외부 bind/다른 프로젝트 자동 조회/부분 graph 자동 관계 복구, 컬럼 단독 clipboard, domain/note/private canvas 복사, 타 DB 변환, 고급 스타일은 이번 bounded 단위에서 제공하지 않는다.
- OS clipboard 권한·localStorage 용량 때문에 큰 입력 보관이 실패하면 기존 memory draft/retry/export guard를 소비한다. 브라우저 저장소 실제 용량 성공이나 브라우저 렌더 성능 QA는 이 단위에서 확인하지 않았다.
