# 비UI 저장 명령 coalescing 결과

## 변경 결과

[계획과 오너 통합 요구사항](../planning/2026-10-08-Sync-BoundedCoalescingPlan.md)에 따라 신규 enqueue 한 번 안의 인접한 동일 대상 안전 patch를 최초 pending 생성 전에 정규화했다. 별도 pure/durable buffer, recovery 프로토콜, 중복 quiet-window 상수는 최종 범위에서 제외했다.

- [native-save-coalescing.ts](../../apps/web/src/features/projects/native-save-coalescing.ts): `coalesceNativeSaveCommands(commands: readonly NativeWebCommand[]): NativeWebCommand[]`만 export한다. table/column logical name/definition, physical comment 및 update_node_layout의 연속 동일 대상 patch를 축약한다. 생략 필드를 보존하며 A→B→A의 마지막 A를 유지한다.
- [native-save-intents.ts](../../apps/web/src/features/projects/native-save-intents.ts): `enqueueNativeSave`에서 operationId 생성 및 immutable intent 저장 전에 helper를 사용한다. 원본 1~100개 명령을 모두 기존 schema로 검증하고 복제하므로 invalid 중간 입력이 최종 patch에 숨겨지지 않고 caller input도 변경하지 않는다.
- [native-save.ts](../../apps/web/src/features/projects/native-save.ts): 제품 코드는 변경하지 않았다. `stageNativeSave`는 과거에 저장된 intent도 받으므로 commands 원문을 유지해야 한다. claim/전송/recovery/cancel/ACK 경로에 정규화를 적용하지 않는다.
- 구조/delete/reorder/physical name/type/scope 및 기타 patch를 경계로 유지한다. 다른 target이나 command 종류를 넘어 재정렬하지 않는다. 서로 다른 enqueue/user/project/expected version/sequence/databaseRevision/draftRef를 병합하지 않는다.
- [native-save-coalescing.test.ts](../../apps/web/src/features/projects/native-save-coalescing.test.ts), [native-save-intents.test.ts](../../apps/web/src/features/projects/native-save-intents.test.ts), [native-save.test.ts](../../apps/web/src/features/projects/native-save.test.ts)에 모델 동등성, 명령 경계 및 요청 불변성 검증을 추가했다.

## ACK와 durable 보존 검증

PostgreSQL/MySQL/SQLite 모델에 원본 10개 명령과 축약 3개 명령을 적용한 결과가 동일했다. 잘못된 중간 comment/크기 및 101개 원본 명령은 거부한다. optional 필드의 explicit undefined는 JSON에서 생략되므로 병합 경계로 유지한다. 이를 앞선 값에 덮어 합쳐서 원래 comment나 resize 값이 사라지지 않도록 별도 회귀 검증했다.

새 enqueue의 실제 intent.pending, staged durable payload 및 POST body가 일치한다. 같은 최종 명령의 반복 enqueue는 동일 operationId를 반환하며, 저장 시 보관한 waiter pending으로 다른 탭의 ACK를 조회할 수 있다. 이미 claim/전송 중인 요청에 새 입력이 들어와도 operationId, 원문 및 POST body가 그대로 유지되고 마지막 입력은 별도 durable intent로 남는다. 정규화 도입 전 저장된 unsent intent의 원래 명령 배열도 그대로 stage/POST된다.

기존 rejected archive, unknown transmission recovery, cancellation fence, 다른 actor 차단, draft ACK source 소비 및 다중탭 lease 테스트가 함께 통과했다. callback/Promise 완료와 ACK 검증 API는 변경하지 않았다.

## UI 연결 및 개선 증거

MAINBoyle(`01a11748-b6d4-7cc1-9d9b-fd149744572b`)와 canvasGodel(`01a11748-be17-78b1-92bb-cba9a8dcae50`)에게 설계 및 최종 API/검증 결과를 직접 전달했다.

UI는 기존 `save(commands, expected?, editorDraft?)` 및 `enqueueNativeSave` 호출을 그대로 사용한다. helper는 enqueue 안에서 이미 연결돼 있으므로 추가 buffer나 pending 수정이 필요 없다. saveWaiters에는 반환 operationId로 조회한 실제 intent.pending을 계속 보관한다.

MAIN 소유 `use-native-autosave.ts`는 quiet window 750ms/최대 대기 2000ms 정책을 사용하고 Godel은 이동의 즉시 로컬 반영 및 disk/frame/end 제출을 구현했다. 해당 UI 파일 및 테스트는 이 작업에서 수정하거나 포맷하지 않았다. 오너가 작성한 테스트를 직접 재실행한 결과:

- hook lifecycle driver: 입력 5회 동안 로컬값이 즉시 바뀌고 750ms quiet 뒤 최종 `abcde` save 1회. 지속 입력은 2000ms에 제출하며 IME/blocked/in-flight ACK 및 explicit flush 동작을 보존한다.
- canvas interaction driver: 이동 100회마다 화면 모델의 위치가 즉시 바뀌고 최종 archive 저장 1회 및 onSave 1회.
- placement persistence: quiet/maxWait, 최종 위치 flush 및 quota 실패 뒤 최신 메모리 입력 보존.

이는 테스트 드라이버의 save 호출 수와 payload 동등성 증거다. 실제 브라우저 DOM/HTTP 통합 또는 프레임 지연 벤치마크는 수행하지 않았다. 신규 enqueue 정규화 자체는 payload 수를 줄이며, 요청 수 감소는 UI 제출 전 debounce/end 정책에서 발생한다.

## 실행한 검증

Node v24.18.1 지정 PATH를 사용했다. 최초 Vitest의 sandbox 임시 캐시 ENOENT는 작업별 `.cache` 임시 경로와 단일 worker로 재실행해 해소했다. 별도 제품 환경 설정이나 의존성은 변경하지 않았다.

- 비UI 7파일 **110 tests 통과**: native-save-coalescing, native-save-intents, native-save, native-durable-queue, native-draft-archive, native-cancellation, native-actor-api.
- UI 오너 3파일 **39 tests 통과**: use-native-autosave.quiet-window, NativeERDCanvas.interaction, native-placement-persistence.
- native-save-coalescing/native-save-intents/native-save production 파일 scoped strict TypeScript 검사 통과: `--ignoreConfig --noEmit --target ES2023 --lib ES2023,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --verbatimModuleSyntax --types vite/client`.
- 대상 6개 코드 파일 Prettier write/check 및 변경 파일 `git diff --check` 통과.
- 이 worker가 작업 중 직접 실행한 전체 `apps/web` TypeScript 검사는 당시 Vitest `Assertion.not` 및 react-aria UI 타입 오류로 실패했다. 이후 사용자가 오너의 canonical pnpm 웹 타입 검사 통과를 확인해 전달했다. 비UI scoped 검사도 최종 소스에서 통과했으며 별도 환경 타입 오류 조사는 진행하지 않는다.

공유 작업 트리의 Git add/commit은 오너가 조정하며 이 비UI worker는 수행하지 않았다. 다른 worker의 변경과 `docs/EZERD.txt`는 수정하지 않았다. 최종 비UI 검증 후 사용자의 요청에 따라 소스를 동결했고 범위를 확장하지 않는다.
