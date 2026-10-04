# Native 갤러리 DB 변경 실제 소비 결과

계획: [Oct3 원본 계획](../planning/2026-10-03-Database-NativeGalleryConversion.md). Oct3 착수, Oct4 source freeze. 서버 정책과 공통 큐 구현은 수정하지 않았다. 부모/Banach의 `databaseChange` kind 및 별도 `confirmDatabaseChangePreconditionConsumed` fence를 실제 소비했다.

## 구현

- App의 실제 `ProjectGallery.onEdit → changeProject` 경로가 최신 versioned `document-state`와 최신 workspace 권한을 읽고, raw source의 schemaVersion으로 분기한다. v1은 기존 preview/metadata 경로를 유지한다.
- Native DB 변경 preview에는 source version/sequence 및 대상 profile을 전달한다. 검토 UI는 DB/버전, 영향받는 테이블·컬럼 이름, `INTEGER → INT`, `public → 현재 데이터베이스`, 엔진 옵션 전후 값과 사람용 진단을 표시한다. 내부 issue code와 profile ID, 일반 검토의 raw JSON은 표시하지 않는다.
- 명시 확인 후 source snapshot/preview/원문 이름 입력/operationId/version/sequence/revision을 공통 IDB 큐에 먼저 보관하고 `/database/change`를 호출한다. 서버 ACK의 ID·대상 문맥·세 카운터를 엄격히 검사하며 lease와 actor/workspace/session을 재확인한다. 빈 native도 서버가 새 문서를 저장하므로 세 카운터 모두 +1을 요구한다.
- DB ACK 뒤 최신 상태를 다시 읽은 version으로 이름만 별도 PATCH한다. Native metadata PATCH에 databaseKind를 넣지 않는다. 이름 ACK 유실 후 같은 operationId로 재확인하고 현재 이름이 일치하면 PATCH를 반복하지 않는다. 이전 요청의 ACK로 더 새로운 갤러리 이름/DB 입력을 지우지 않는다.
- stored load와 기존 ACK 재확인은 read 경계다. 새 stage 및 이름 PATCH는 live edit 경계다. viewer·보관 전환 뒤 기존 ACK는 복구할 수 있으며 이름은 자동으로 덮어쓰지 않는다.
- 유효한 old ACK 뒤 DB revision 또는 이름이 더 진행했으면 원문/이름/ACK/fresh snapshot을 dedicated archive에 먼저 보관한 뒤 exact ACK로 이전 큐를 해제한다. 새 설계를 표시하며 갤러리 입력은 보존한다.
- ACK 없는 stale 요청은 fresh version 또는 revision의 strictly greater 및 나머지 카운터 비감소를 확인한다. 동일 원문 요청의 실제 409만 미확정 proof로 받아들이며, 해제 시에도 fresh 상태와 동일 endpoint 증거를 다시 확인한다. 사용자 체크와 명시 해제 후 live owner/token/lease fence 안에서 archive를 보관하고 uncertain을 해제한 뒤 별도로 discard한다. `confirmRejected`와 private CAS fence를 혼용하지 않는다. 이 archive는 **적용 여부 미확정 / 새 변경 불가**를 명확히 표시한다.
- Archive는 actor/project/operation/outcome별로 보관하고 갤러리의 별도 원문 보기 UI에서 실제 소비한다. 동기 저장 및 readback 실패는 큐 해제를 막는다. malformed own evidence를 삭제하지 않는다.
- 실제 pending를 읽은 native 프로젝트만 갤러리 복구로 가로챈다. IDB unknown/저장 접근 거부는 empty로 처리하지 않으며 기존 NativeView의 queueUnknown 쓰기 차단과 원본 읽기를 유지한다. actor/workspace/session 변경은 별도 오류로 남는다.

## 검증

- `pnpm exec vitest run ...native-gallery-conversion.test.ts ...native-gallery-conversion-wire.test.ts ...database-preview.test.ts ...project-entry.test.ts`: **4 files / 62 tests PASS**.
- `pnpm --filter @ezerd/web typecheck`: **exit 0 PASS**.
- 변경 파일 및 원본 계획에 한정한 Prettier check: **PASS**. App diff whitespace check: **PASS**.
- Helper의 model-backed transport/IDB 테스트: empty PG→MySQL/SQLite; verified signed PG↔MySQL; physical→SQLite 차단; source raw 이름 보존; strict preview/ACK; stale snapshot/다른 writer/미저장 입력/저장 실패; change ACK 및 name ACK 유실; viewer/보관 뒤 ACK; 새로운 갤러리 입력 보호; old ACK 이후 rename/revision archive; ordinary409 fresh proof 명시 해제; sequence-only/동일·역행 counter/403/transport 실패/가짜 ACK/새 fresh 상태/아카이브 quota의 해제 거부.
- 실제 App AST 검사: 갤러리 onEdit와 검토 host 연결, native branch의 legacy PATCH 이전 return, source-v2 분기, viewer/unknown-safe open dispatcher와 recovery interception. SSR 검토/아카이브 UI의 사람이 읽는 전후 값·진단·원문 보기 확인.

위 단위 테스트는 실제 HTTP/DB/browser 성공으로 계산하지 않았다. 부모가 source freeze 이후 3139 empty change와 3150 response-loss 실제 UI/ledger QA 및 최종 full check/build를 수행한다.

## 변경 파일

- `apps/web/src/app/App.tsx`
- `apps/web/src/features/projects/NativeGalleryConversion.tsx`
- `apps/web/src/features/projects/native-gallery-conversion.ts`
- `apps/web/src/features/projects/native-gallery-conversion-archive.ts`
- `apps/web/src/features/projects/native-gallery-conversion.test.ts`
- `apps/web/src/features/projects/native-gallery-conversion-wire.test.ts`
- Oct3 원본 planning 및 이 Oct4 work-log.

## 제한

- 동일 counters의 미확인 요청은 유효 ACK 또는 미래의 단조 증가 증거가 생길 때까지 보존한다. 일반 403·transport 실패만으로 해제하지 않는다. 서버 API에 새 cancel 기능을 추가하지 않았다.
- Dedicated archive는 기존 동기 archive 패턴과 같은 localStorage를 사용한다. 큰 snapshot의 quota/손상/접근 실패는 pending를 유지하며 자동 정리하지 않는다. Archive 삭제 UX는 이 단위 범위 밖이다.
- 이 UI는 기존 planner의 검증된 변환만 소비한다. 미검증 기능 coverage를 바꾸거나 SQLite 등 미검증 물리 변환을 승인하지 않는다. 전체 C8/전체 기능 완료를 주장하지 않는다.
- 브라우저 및 전체 통합 검증은 부모 담당으로 남아 있다. 다른 작업의 변경/진행 문서, 서버·모델·공통 큐 파일과 사용자 관리 docs/EZERD.txt는 수정하지 않았다.
