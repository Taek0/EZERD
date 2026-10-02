# Native 도메인 lifecycle·소유권 이동 계획

- 작성일: 2026-10-02
- 기준 HEAD: `3d87167`.
- 기준: [DB 명세](2026-10-01-Database-CapabilitySpecification.md), [native canvas](2026-10-02-Database-NativeCanvas.md).
- 범위: 순수 모델 `native-domain*.ts/test`, strict editor 명령 계약/test, 새 MCP 후보 helper/test, 이 계획과 결과 기록. UI·공개 index·커밋·history 통합은 main 담당이다.

## 정책

1. native 도메인 생성은 overview node를 함께 만들고 identity/좌표/metadata를 검증한다. 수정은 name/description/color만 허용하며 JSON null로 색상을 지울 수 있다.
2. 테이블 domainId 이동은 존재하는 도메인 또는 미소속(null)으로만 허용한다. 테이블 ID와 physical/logical payload, 컬럼 소유자·원문, FK/키/index/check/ENUM은 바꾸지 않는다. 기존 legacy provenance 검사도 그대로 적용한다.
3. 공유 canonical 배치는 보존한다. canonical이 없고 이전 도메인 배치가 있으면 동일 node ID/geometry를 canonical로 옮긴다. 다른 도메인 참조 및 개인 화면의 잘못된 membership/route를 정리하고, 개인 참조를 자동 생성하지 않는다.
4. 도메인 삭제 명령은 명시 정책을 요구한다: `rejectNonempty`, `moveTables(targetDomainId)` 또는 `deleteTables(cascadeGeneratedColumns?)`. 후자는 기존 native 삭제 planner를 사용하고 외부 식 의존성/FK/키/생성 규칙의 차단을 유지한다.
5. domain/view/note/route/viewport 참조 정리의 삭제 영향을 preview로 반환한다. source를 변경하지 않고, 신규 legacy 복제 및 필수 참조 오류의 도입을 거부한다. 후보의 기존 ID 재사용과 같은 batch에서 삭제 후 ID 재사용을 거부하며 persisted retired ID 검사는 기존 locked sync에 남긴다.

## 통합·검증

- 현재 전체 native candidate는 `mcp-native-document.service.ts` 내부에 있고 `native-command-renderer.ts`는 없다. 새 파일은 도메인 명령 후보를 제공한다. 사용자 후속 승인으로 기존 live service의 renderer branch/metadata/공통 batch claims 연결까지 포함한다. public index는 main이 연결하고 UI/MCP 등록/native sync/history는 수정하지 않는다.
- 의미 있는 대상 테스트: 세 DB 원문/FK 보존, 빈/비어 있지 않은 도메인, 이동·연쇄 삭제 정책, 외부 식 blocker, canvas/personal 참조 정리, 원본 불변성, strict patch/ID 및 batch claims.
- 변경 파일만 포맷하고 targeted tests와 source 기반 typecheck를 수행한다. 전체 기능 완료·실제 HTTP/MCP 성공은 주장하지 않는다.

## 후속 소유권 조정

- 사용자 최초 확대 승인 때 기존 서비스 renderer의 domain branch/metadata/공통 claims를 연결했다. 이후 Singer의 replay transaction 변경 소유권을 확인한 사용자 지시로 `mcp-native-document.service.ts`와 `NativeSyncService`의 추가 편집을 중단한다.
- 앞서 승인받아 서비스에 추가한 hunk는 main이 Singer 변경과 함께 최종 연결/리뷰/분리한다. 현재 단위의 ready는 순수 model/contracts/helper/tests 기준이며 실제 live QA는 main 최종 통합 후 수행한다.
