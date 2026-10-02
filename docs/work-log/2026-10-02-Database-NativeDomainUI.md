# Native 도메인 lifecycle UI 결과

- 작성일: 2026-10-02
- 계획: [NativeDomainUI](../planning/2026-10-02-Database-NativeDomainUI.md).
- 모델/서비스 선행 단위: [NativeDomainLifecycle](2026-10-02-Database-NativeDomainLifecycle.md). main의 모델 public export와 실제 renderer 연결을 소비한다.
- git add/commit과 progress 갱신은 하지 않았다. main이 범위 확인 후 독립 커밋한다.

## 변경 범위

- 새 `apps/web/src/features/projects/NativeDomainEditor.tsx`와 `NativeDomainEditor.test.ts`, `NativeDomainEditor.pending.test.ts`.
- `NativeProjectView.tsx`, `NativeERDCanvas.tsx`, `NativeERDCanvas.test.ts` 및 이 단위 계획/결과 문서.
- Hypatia의 format/structure/option-policy, App/기존 Canvas, 모델/계약/public index, 서버/sync 및 SQL export는 편집하지 않았다. header의 main projectActions 함수 prop/렌더와 기존 history 진입을 유지했다.

## 구현

- 생성/metadata patch/삭제 정책/테이블 분류 이동을 `nativeDomainCommandSchema`의 `add_domain`, `patch_domain`, `delete_domain`, `move_table_domain`으로 구성하여 기존 NativeEditorForm→NativeProjectView→native-save 실제 저장 경로에 넘긴다.
- 새 domain/overview node의 ID는 LAN에서도 사용 가능한 main의 `nativeDurableId`로 만들며 생성 draft를 다시 열 때 저장된 두 ID를 유지한다. domain 생성/patch/이동/삭제는 선행 순수 모델로 먼저 검증한다. patch는 변경된 name/description/color만 보내며 빈 color는 명시 null이다. clean 저장은 기존 form의 비활성/전송 guard를 소비한다.
- 삭제 정책은 비어 있을 때만 삭제/테이블을 다른 domain 또는 미소속으로 이동 후 삭제/소속 테이블까지 삭제를 명시한다. owned table, 컬럼/키/FK/index/check/ENUM, domain relation/note/private view/node/viewport/route 영향을 표시한다. 외부 expression blocker를 표시하고 generated 연쇄 삭제를 명시 체크박스로 제공하며 cascade 대상 이름을 별도로 표시한다.
- 삭제·이동 확인은 대상 ID, 정책/목적지/cascade와 version/sequence/databaseRevision에 묶는다. 대상/정책/저장 기준이 바뀌면 이전 확인으로 명령을 만들지 못한다. table 이동은 삭제되는 배치/route를 표시하며 원래 type/default/generation/namespace/FK/컬럼 tableId를 보존한다. domain은 ERD 분류이며 SQL namespace 변경으로 처리하지 않는다.
- canEdit/active/source v2 및 기존 busy/pending/form draft·revision·DB 문맥 보호를 소비한다. 읽기 전용 상태에서도 metadata를 표시한다. domain 선택은 editor를 열고 summary에 focus한다. domain 삭제 대상 변경 시 삭제 action을 유지하여 수정 action으로 돌아가지 않는다.
- overview 카드는 저장된 domain node와 배치 없는 domain을 모두 표시한다. 배치 없는 카드는 renderer 안에서만 임시 위치를 만들고 raw source node가 없는 domain은 pointer/키보드 배치 저장을 막는다. 카드/제목/Enter 선택은 domain editor로 연결한다. 원본 및 v2 물리 payload를 v1로 투영하지 않는다.
- 기존 다른 노드의 미저장 배치가 있을 때 Enter가 그 배치를 우연히 저장하지 않도록 해당 objectId의 draft인지 확인한다. tableId 미선택 시 undefined 비교로 domain/note가 자동 선택되던 표시도 수정했다. 새 domain UI와 충돌하던 이전 미지원 안내를 제거했다.

## 비동기 저장 연결

- 작업 중 main이 승인한 Banach의 비동기 load/stage/discard API와 main `useNativeDurableState`를 소비했다. helper 파일은 편집하지 않았다.
- load는 effect cleanup과 actor/project 세대를 확인한 뒤 상태에 반영한다. stage를 await해 보관이 끝난 뒤에만 pending을 표시/전송하며 동시 클릭은 ref로 막는다. stage 중 actor/project가 바뀌거나 권한/저장 문맥이 바뀌면 옛 요청을 보내지 않는다.
- accepted ACK만 pending을 소비한다. stage/send 실패 시 보관된 요청을 다시 읽고 실패 오류를 유지한다. 큐 unknown/pending/sending은 모든 native editor writer의 busy와 저장 guard에 반영한다. unknown은 상태 확인 재시도를 제공한다.
- 폐기는 await 후 남은 요청을 다시 읽어 상태를 바꾼다. 실패/진행 중이면 pending을 유지한다. 복구는 기존 helper의 replay-before-write-validation 및 readonly old-ACK 확인 정책을 그대로 소비한다. 늦은 응답은 다른 actor/project의 pending/error/reload를 변경하지 않는다.
- domain form은 NativeEditorForm의 dirty/storageFailure export hook과 draft memory/retry/ACK revision 보호를 소비한다. 개인 카메라 저장을 새로 활성화하거나 physical coverage/fixture usable 상태를 바꾸지 않았다.

## 검증

- 최신 model/contracts source alias를 사용한 Vitest 대상 4개 파일 **53개 전부 통과**, skip 없음: 새 domain UI/command 21개, 비동기 root 저장 9개, 기존 canvas 21개, project view 2개.
- 세 DB domain 생성·변경/이동 preflight와 source 불변/legacy 보존, strict metadata 계약, 세 삭제 정책, generated 의존성 blocker/cascade, 확인 token 무효화, readonly/archived/pending 및 stale draft, overview raw/임시 node 경계와 main actions 유지에 대한 static/명령 검증을 수행했다.
- root hook driver의 지연 Promise 테스트는 load/stage 완료 전 전송 금지, actor/project 변경, 권한/DB revision 변경, lost ACK, storageunknown 및 await discard 실패 보존을 검증한다. DOM/browser 상호작용 테스트는 아니다.
- 실제 native-save와 테스트 IndexedDB runtime을 사용한 domain command 보관·전송/유실 ACK·readonly old-ACK 조회 테스트가 실행되어 통과했다. matching pending만 소비하고 더 최신 domain draft revision은 유지됨을 확인했다. transport는 mock이므로 실제 HTTP/MCP/DB 성공 증거로 주장하지 않는다.
- 담당 코드 6개 파일과 transitively imported 최신 source의 noEmit typecheck 통과. 웹 전체 source typecheck는 실행 당시 다른 담당의 `project-transfer.ts:51` TranslationParams와 `ProjectTransfer.tsx:83` formatVersion union 오류 2건으로 실패했으며 해당 파일은 편집하지 않았다.
- 변경 코드만 Prettier 적용/확인 및 범위 diff whitespace 확인. 전체 check/build/format과 git add/commit은 하지 않았다.

## 남은 QA·제한

- main 최종 browser QA: 실제 domain 메뉴 생성/수정/정책 확인/삭제/이동, 클릭·Enter·focus, pending 및 탭/actor 변경, 도메인 삭제 후 개인 참조 재조회와 실제 ACK를 확인해야 한다. 이 단위는 browser QA를 수행하지 않았다.
- 영향 표시는 현재 사용자에게 병합된 document의 참조 기준이다. 다른 사용자의 private state를 읽거나 표시하지 않는다. 서버가 실제 공유 저장/개인 참조 정리의 최종 권한과 동시 변경을 판단한다.
- 배치 없는 기존 domain 카드는 조회/선택 가능하지만 임시 배치 자체를 저장하지 않는다. 새 domain은 생성 명령으로 실제 overview node를 만들고, 기존 raw node는 기존 canvas 배치 명령을 소비한다.
- domain relation lifecycle, 고급 스타일/대규모 배치, 개인 저장 UI의 DB revision gate 해제, 전체 native 기능/물리 coverage 완료는 이 단위 범위 밖이다.

## LAN HTTP UUID 감사 후속

- main의 LAN HTTP 감사 요청으로 `NativeERDCanvas.tsx` 제품 randomUUID 7곳을 모두 `nativeDurableId(getRandomValues)`로 교체했다. 개인 pending revision, 없는 raw table의 reference nodeId, 이동 draft revision/재비교, action 객체 ID, canvas form fresh/rebase revision을 포함한다. 테스트 fixture의 개발 Node randomUUID는 유지했다.
- `NativeDomainEditor`의 신규 domain/node ID는 이미 동일 helper를 소비하고 있어 제품 코드를 추가 변경하지 않았다.
- `isSecureContext=false`, randomUUID/subtle 없는 getRandomValues-only crypto로 테스트 3개 추가: 신규 참조/개인 pending UUID v4·보관 및 같은 pending ACK 복구, editable canvas action/form 초기화, domain/node/form 초기화. 조회/초기화만으로 저장을 전송하거나 원본을 바꾸지 않음도 확인했다.
- 최신 source alias targeted 4파일 **56개 전부 통과**, 담당 파일 source noEmit typecheck 통과. 변경 코드만 Prettier 확인하고 제품 두 파일의 randomUUID 호출이 남지 않았음을 검색 확인했다. 실제 LAN browser QA/전체 check/커밋은 main 담당이다.
