# Native activation 후 provenance/clipboard 기대값 정합성 결과

## 완료 범위

부모 advanced coverage 활성화 후 지정한 세 테스트 파일에서 stale gate 기대값으로 발생한 6개 실패를 재현하고 수정했다. 활성화된 유효 입력 성공과 실제 engine-invalid 입력 차단을 분리했다. 생산 registry/gate/model/validation/service/helper는 변경하지 않았다.

- `apps/server/test/native-import-provenance.test.ts`: 신규 native index/check/key/generation의 오류가 원본 legacy 증명에 가려지지 않도록 HASH UNIQUE, 숫자 CHECK, 중복 key 열, generated/default 동시 설정을 확인한다. fresh 오류와 provenance 결과를 대조하며 mask에는 key/index/check와 신규 generation이 없음을 검증한다. 별도 유효 native key/index/check/generated graph + 원본 legacy 열 조합은 성공하고 입력 원문은 불변이다. SQLite WITHOUT ROWID는 활성화 여부 대신 PK 누락과 STRICT legacy type 오류를 확인하며, 유효 PK/비STRICT 조합은 원본 legacy를 유지해 성공한다.
- `packages/contracts/src/native-clipboard.test.ts`: 3DB 전체 유효 graph의 canApply=true/오류 없음으로 수정했다. 생성식/index/check/FK/좌표 remap과 source/target 불변, 개인 payload 제외 검증을 유지한다. 동일 enum definition의 재사용과 다른 definition의 새 ID remap은 모두 성공해야 한다.
- `apps/server/test/native-clipboard-command.test.ts`: 유효 BTREE physical index는 ordinary candidate 성공을 요구하고 HASH UNIQUE는 구체적인 `index.unique-method-not-supported` 오류로 차단한다. 이 오류는 clipboard schema의 engine inspection에서 먼저 발생하므로 HTTP BadRequestException으로 단정하지 않는다. 별도 미검증 `postgresql:txid_snapshot` type는 실제 ordinary write policy에서 `clipboard.policy-blocked`/`type.not-implemented`로 차단되어야 한다. 원본 baseline 불변을 확인한다.
- [계획](../planning/2026-10-03-Database-NativeActivationExpectations.md) 및 이 결과 기록.

foreign DB, logical legacy 복사 금지, 같은 batch에서 삭제 후 ID 재사용/충돌, allocator 충돌, 외부 reference/개인 payload, 기존 legacy byte cause와 신규 options/generation 구분, 전체 table budget, 원문 SHA/token, 오래된 replay의 validation 이전 처리 검증을 보존했다. source 객체 전체를 trusted previous로 삼거나 fake coverage를 주입하지 않는다.

## 검증

2026-10-03 담당 targeted 검증 결과:

| 검증 | 결과 |
| --- | --- |
| 세 파일 Vitest | 32 PASS: provenance 15 / clipboard contract 10 / clipboard command 7 |
| 세 파일 entry의 strict targeted TypeScript | PASS |
| 담당 파일 Prettier / diff whitespace | PASS |

```powershell
pnpm exec vitest run apps/server/test/native-import-provenance.test.ts packages/contracts/src/native-clipboard.test.ts apps/server/test/native-clipboard-command.test.ts
pnpm exec tsc --noEmit --ignoreConfig --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --verbatimModuleSyntax --target ES2023 --lib ES2023,DOM --module NodeNext --moduleResolution NodeNext --skipLibCheck apps/server/test/native-import-provenance.test.ts packages/contracts/src/native-clipboard.test.ts apps/server/test/native-clipboard-command.test.ts
```

검증은 공유 build가 준비된 현재 registry 기준이다. full suite/build 및 actual API/engine 재실행은 하지 않았으며 부모 통합 QA를 대체하지 않는다. 저장소 권한 profile 변경에 따라 승인된 파일 수정과 targeted 명령은 require_escalated로 실행했다.

계획은 최초 10월 2일 작성 후 재개일 10월 3일에 경로/결과 기록을 갱신하여 현재 파일명 날짜 규칙에 맞췄다. feature-path fixture와 ready 문서는 이 후속 범위에서 변경하지 않았다. 별도 등록 필요 사항과 담당 미완료 항목은 없으며 ready 상태로 scope를 종료한다. git add/commit하지 않았다.
