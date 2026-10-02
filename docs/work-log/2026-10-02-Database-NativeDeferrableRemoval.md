# Native root deferrable 명시 제거 계약 완료

2026-10-02. [계획](../planning/2026-10-02-Database-NativeDeferrableRemoval.md). 독립 unit ready. 변경은 contracts/native-editor-command schema/type 및 test, 서버 native-editor-candidate의 두 constraint patch helper, mcp-native-document.service의 patch_key/patch_foreign_key 두 연결, 전용 fixture/unit/integration test이다. model/registry/validator/enum labels/structure UI/shared root는 변경하지 않았고 git add/commit 하지 않았다.

## 계약과 consumer

root deferrable은 생략=유지, object=명시 설정/교체, null=resulting optional field delete이다. NativeKeyPatch와 NativeForeignKeyPatch output 타입을 공개 contracts barrel이 그대로 export한다. null은 patch schema에만 허용한다. add_key/add_foreign_key 및 stored document의 deferrable은 기존 object-only optional이며 null을 저장할 수 없다. own property로 주어진 undefined는 deferrable.explicit-undefined refinement에서 거부한다. undefined를 누락으로 sanitize하거나 null 삭제 토큰으로 사용하지 않는다. nested physical/logical deferrable 및 unknown fields도 strict schema에서 거부한다.

서버의 patchNativeConstraintKey/patchNativeConstraintForeignKey는 실제 parse한 patch의 Object.hasOwn으로 세 상태를 구별한다. null이면 delete하고 stored null/undefined own property를 만들지 않는다. 기존 FK logical/physical partial merge, missing physical relation guard 및 missing object 오류를 유지한다. 입력과 원본을 변경하지 않고 다른 raw optional/metadata/legacy field를 보존한다. generic patchObject 및 index/check/enum patch 의미는 바꾸지 않았다.

nativeEditorCandidate→기존 deriveOperationChanges/applyChanges→잠긴 현재 문서의 prepareNativeSyncCandidate→validateDatabaseDocument(previous=current)의 기존 경로를 그대로 소비한다. /keys/<escaped-id>/deferrable 및 /tableRelations/<escaped-id>/deferrable는 기존 atomic value path이다. 삭제는 after:null, afterExists:false로 표현되고 모델 apply는 optional field 자체를 제거한다. 이 모델 sync 소비를 실제 unit/service에서 검증했으며 model source를 새로 변경하지 않았다.

## 실제 서비스 검증

scripts/test-isolated.ts의 localhost URL 검증·fresh UUID ezerd_qa_* DB 생성/migration/finally DROP을 사용했다. 실제 compiled AppModule HTTP 인증/session/owner workspace/project를 사용하고 PostgreSQL/MySQL/SQLite 문서 프로필 각각에서 실행했다. MySQL/SQLite 물리 SQL 엔진에 이 JSON patch를 실행했다고 주장하지 않는다. 이 QA 대상은 실제 durable backend service와 공통 모델 검증이다.

기존 옵션 보존/복구를 검증하기 위해 자체 QA 프로젝트에 pre-existing root deferrable와 untouched legacy type/default 원문을 심었다. 신규 제품 권한/registry override가 아니다. fixture는 gate=false를 고정하거나 검사 우회를 주입하지 않는다. 실제 검증은 당시 registry 및 locked-current previous를 그대로 사용한다.

각 프로필에서 omitted key patch와 FK logical metadata edit는 저장 ACK를 받고 두 deferrable을 유지했다. 이어 명시 null 두 개를 atomic command batch로 보내 version8→9, sequence12→13, DB revision0 유지, 두 optional field 삭제 및 나머지 전체 source를 확인했다. ACK document/changedPaths, 실제 sync_operations의 before/after/afterExists:false와 field version13/operation ID가 일치한다.

동일 요청은 동일 original ACK를 재생하고 row/ledger를 재작성하지 않았다. 같은 operation에서 null을 omission으로 바꾼 요청은 정확한 sync.replay-mismatch409로 거부됐다. stale snapshot의 fresh 요청도409이며 ledger/row를 바꾸지 않는다. 더 최신 metadata write 후에도 오래된 clear ACK는 original document 그대로 재생된다. 새 deferrable target key는 active registry에서도 FK reference target이 될 수 없는 engine 조건으로 거부되고 문서/version은 유지된다. rejected ACK의 sequence만 한 번 소비하며 동일 rejection도 재생된다. 전용 DB/listener는 모두 정상 정리됐다.

## 검증과 인계

- contracts command + candidate/model consumer + 기존 server renderer/domain helper4파일: **31 passed**, skip0.
- 실제 isolated AppModule3프로필: **3 passed**, skip0. replay-mismatch code 구분을 추가한 최종 재실행도 통과.
- contracts build/typecheck, server build/source typecheck, 전용 server test+fixture 및 contract test의 strict 별도 typecheck 통과. 담당7파일 root Prettier/whitespace check 통과.
- 최초 server tools 검사에는 부모 WIP native-feature-path-fixtures.ts의 requiredFeatures string[] 타입 오류가 있었다. 해당 파일은 수정하지 않았고 tools/fullcheck 재검사는 부모 범위다. 이 unit의 source/build/test 타입 결과와 구분한다.

Hypatia 구조 UI는 OFF를 root `{deferrable:null}`로 보내고 unchanged option은 키 자체를 생략한다. 명시 undefined나 `{initially:undefined}`를 만들지 않는다. key/FK의 다른 fields/physical nullable 의미는 변경하지 않았다. shared barrel의 새 NativeKeyPatch/NativeForeignKeyPatch 및 NativeEditorCommand를 소비하면 된다. UI 연결은 이번 unit 범위가 아니다.

부모는 이 작은 논리 단위를 독립 커밋한다. 다음 actual WebSocket DB-conversion QA는 부모가 계약 unit 커밋을 확인한 뒤 별도 planning/test/work-log 단위로 시작한다. 이 unit의 HTTP/ACK 검증을 실제 socket frame 수신 검증으로 주장하지 않았다.
