# Native 도메인 lifecycle·소유권 이동 결과

- 작성일: 2026-10-02
- 계획: [NativeDomainLifecycle](../planning/2026-10-02-Database-NativeDomainLifecycle.md).
- 기준 HEAD: `3d87167`.
- 커밋/public index/UI/history 통합은 main 담당이다. git add/commit은 수행하지 않았다.

## 구현

- `packages/model/src/database/native-domain.ts`: `addNativeDomain`, `updateNativeDomain`, `moveNativeTableDomain`, `planNativeDomainDeletion`, `removeNativeDomain`과 patch/삭제 정책/영향 타입을 제공한다.
- 생성은 overview node와 domain ID를 검증하며 ID 충돌·reserved ID·좌표·metadata injection·중복 배치를 거부한다. 긴 Unicode ID의 node prefix를 안전하게 줄이고 충돌 suffix를 생성한다. 저장된 JSON payload의 clone 방식은 기존 모델과 같다.
- patch는 name/description/color만 수정한다. `color: null`은 색상 제거이고 id/domainId/physical/컬렉션 주입은 거부한다.
- table domainId 이동은 native 테이블 ID·physical/logical 정보, namespace/default/generated·컬럼 소유자·키/index/check/ENUM/FK를 유지한다. canonical 배치는 유지하고 owner-only node는 같은 ID/geometry로 canonical에 옮긴다. 이전 도메인 참조 및 개인 membership/route는 정리하지만 개인 화면에 새 참조를 자동 생성하지 않는다.
- 도메인 삭제의 기본 모델 정책은 `rejectNonempty`이고, command 계약은 정책을 명시해야 한다. `moveTables`는 지정한 도메인/null로 테이블을 옮기고 `deleteTables`는 기존 native deletion planner를 사용한다. 외부 expression/generated 의존성의 blocker와 명시 cascade 옵션을 그대로 적용한다.
- 삭제 planner는 moved tables, native 삭제 영향, domain relation/note/view/node/viewport/route 제거를 반환한다. blocker가 있으면 최상위 적용 document는 원본을 유지한다. bulk move는 최종 후보 기준으로 정리하여 중간 상태만 보고 살아남을 FK route를 지우지 않는다.
- 새 reference 오류를 도입하지 않으며 `inspectNativeLegacyChanges`를 그대로 소비한다. 테이블의 도메인 분류 이동은 컬럼 tableId 소유자 변경과 다르다. legacy 원문/컬럼 tableId가 같은 이동은 보존하고, legacy 복제·컬럼 reparent 등 기존 정책은 완화하지 않는다.
- `packages/contracts/src/native-editor-command.ts`: `add_domain`, `patch_domain`, `delete_domain`, `move_table_domain`의 strict 계약과 `nativeDomainCommandTypes`를 추가한다. personal command union에는 넣지 않는다. 물리 테이블 patch로 domainId를 바꾸는 기존 금지는 유지한다.
- `apps/server/src/mcp/native-editor-candidate.ts`: domain branch와 전체 batch에 걸쳐 유지되는 occupied/retired ID claims를 제공한다. 삭제 뒤 ID를 다시 쓰지 못하며 다른 renderer branch가 공유한 claims도 소비한다. 최종 stored shape 및 legacy 검증을 수행하고 locked sync의 persisted retired ID/권한/DB 정책 검증을 대체하지 않는다.

## 서비스 소유권과 인계

- `native-command-renderer.ts`는 없고 실제 기존 renderer는 `mcp-native-document.service.ts` 내부다. 사용자 중간 승인으로 domain helper import, branch, metadata 및 공통 claims 연결을 이 파일에 추가했다. generic canvas가 생성한 node ID도 batch claims에 남기도록 했다.
- 이후 사용자 지시로 해당 서비스는 Singer 소유가 되어 추가 편집을 중단했다. 이 승인 구간의 변경 hunk는 현재 diff에 남아 있다. main이 Singer의 transaction callback 변경과 함께 최종 리뷰·연결/커밋 범위를 결정해야 한다. Singer의 replay/locked baseline callback은 되돌리지 않았고 NativeSyncService는 수정하지 않았다.
- 관련 renderer 테스트의 mock도 새 locked preparation callback 계약에 맞췄다. 이 테스트는 후보·handler wiring 단위 검증이며 실제 REST/MCP 저장·권한·재생 HTTP 성공 증거는 아니다.
- public model export는 main이 연결했다. NativeView/Canvas/다른 UI/공개 index/MCP 등록/history는 이 담당자가 수정하지 않았다.

## 검증

- 대상 Vitest 4개 파일 **36개 통과**: 새 domain 모델·계약/helper 및 기존 native command 회귀. 세 DB legacy/native 원문과 FK/키 보존, source 불변성, 명시 삭제·이동 정책, 외부 generated blocker/cascade, personal view/note/route 정리, Unicode/ID collision, retired/batch reuse, strict injection 및 callback 기대값을 포함한다.
- `packages/model` 및 `packages/contracts` noEmit typecheck 통과. 처음 모델의 structuredClone lib/import 오류는 기존 JSON clone 방식으로 해결했다.
- 최신 contracts/model source를 paths로 직접 참조한 서버 helper·관련 테스트 noEmit typecheck 통과. 다른 담당의 option-policy WIP 오류가 잠깐 있었으나 최종 재검증은 통과했다.
- 담당 코드/테스트 7개 파일의 Prettier 적용·확인과 기존 수정 파일의 `git diff --check`를 완료했다. 최종 targeted 재실행도 36개 통과했다. 서비스 파일은 최종 소유권 지시에 따라 추가 포맷/수정하지 않고 main이 통합한다. 전체 check/build·브라우저/live HTTP/MCP QA는 수행하지 않았다.

## 남은 제한

- 메인 통합 검증: public model export 및 실제 renderer domain 분기를 연결하고 대상 순수 모델·계약·candidate 30개를 확인했다. 실제 AppModule versioned HTTP 40개에서 세 DB domain 생성→legacy 테이블 이동→nonempty 삭제 차단→명시 다른 domain 이동 삭제와 원문 보존을 검증했다. 신규 REST fixture의 body projectId 주입을 제거하고 전체 suite를 다시 통과했다. replay callback 변경과 이에 종속된 기존 mocked-handler 테스트는 별도 NativeReplayAccess 커밋으로 분리하며 이 단위의 새 candidate 테스트는 callback에 의존하지 않는다.

- 실제 서비스 최종 연결·Singer hunk 분리·권한/replay/retired ID의 live QA는 main이 확인한다. 순수 model/helper가 persisted history를 독자적으로 읽거나 privileged restore를 허용하지 않는다.
- 도메인은 ERD 그룹이며 DB physical namespace 변경이 아니다. 도메인 삭제로 SQL schema를 삭제하거나 테이블 physical 정보를 변환하지 않는다.
- UI, 자동 private reference 생성, undo/restore/history 소비 및 대규모 bulk 성능 검증은 이 단위 범위 밖이다. coverage/완료 fixture 상태를 바꾸지 않았고 전체 native 기능 완료를 주장하지 않는다.
