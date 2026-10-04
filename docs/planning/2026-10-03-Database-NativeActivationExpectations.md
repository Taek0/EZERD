# Native activation 후 provenance/clipboard 기대값 정합성 계획

## 범위와 목적

부모 활성화 후 전체 unit 실패 중 `apps/server/test/native-import-provenance.test.ts`의 두 stale feature gate 기대값, `packages/contracts/src/native-clipboard.test.ts`의 세 active graph 기대값, `apps/server/test/native-clipboard-command.test.ts`의 한 stale rejection을 수정한다. 생산 registry/gate/model/validation/helper는 수정하지 않으며 git add/commit하지 않는다.

활성화된 유효 graph는 canApply/ordinary candidate 성공을 요구한다. provenance는 검증 가능한 legacy 원문만 복구하며 신규 native generation/옵션/constraint의 실제 engine-invalid 오류는 fresh validation에서 보존되어야 한다. SQLite WITHOUT ROWID의 현재 지원과 PK 필수 오류를 분리한다.

clipboard 부정 사례는 미활성 feature 대신 실제 invalid combination을 사용한다. 기존 foreign DB, private/legacy copy, ID collision/같은 batch 삭제 후 재사용, enum definition 일치 여부 검증을 보존한다. 동일 enum 재사용과 다른 definition의 새 ID remap은 별도 성공 사례로 확인한다.

세 test 파일의 targeted 실행으로 실패를 재현하고 수정 후 unit/format/typecheck를 수행한다. actual API/전체 QA 및 생산 정책 활성화는 부모 소유다. 결과는 `docs/work-log/2026-10-03-Database-NativeActivationExpectations.md`에 기록한다.
