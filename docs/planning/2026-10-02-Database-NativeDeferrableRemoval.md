# Native root deferrable의 명시 null 제거 계약

2026-10-02. 담당 scope는 contracts/native-editor-command의 patch_key·patch_foreign_key schema/type와 서버 native editor candidate의 해당 consumer, 의미 있는 계약/candidate/actual service tests다. 구조 UI는 Hypatia 다음 단위이고 enum labels/registry/부모 파일을 변경하지 않는다. model/validator/sync에 이미 있는 optional-field removal 및 locked-current previous 검증을 그대로 소비한다. git add/commit 하지 않는다.

root deferrable 입력은 세 상태다. 생략은 기존 객체를 유지하고, {initially:immediate|deferred}는 명시 설정/교체이며, null은 resulting optional field 자체를 delete한다. undefined는 null/생략으로 정상화하지 않고 명시 undefined 입력을 거부한다. 저장 문서에 deferrable:null 또는 undefined own property를 남기지 않는다. key/FK의 다른 raw 필드와 nested logical/physical 내용은 원문 그대로 보존한다.

nullable는 patch 계약에만 추가하고 add_key/add_foreign_key 및 stored document schema는 기존 object-only optional을 유지한다. generic patchObject의 다른 컬렉션 의미를 바꾸지 않는다. 필요한 좁은 constraint patch helper를 서버 renderer에 연결한다. schema는 root 위치만 허용하고 physical/logical 안 misplaced deferrable/null 및 unknown fields를 거부한다.

검증은 schema 생략/명시 null/설정/잘못된 값/undefined, candidate immutability·다른 필드 유지·nested partial merge·없는 필드 null의 no-op, deriveOperationChanges의 atomic /deferrable removal beforeExists/afterExists 및 applyChanges roundtrip을 포함한다. actual service는 local UUID disposable QA DB에서 current locked previous의 기존 raw 보존/제거, write ACK와 원문 replay, 같은 operation의 omission-vs-null identity conflict, stale/current counter 및 새 unsupported deferrable 거부를 확인한다. service/contract/typecheck/Prettier/work-log 후 ready를 보고한다. UI/root 연결·commit은 부모 담당이다.
