# v1 DB 타입·기능 UI 경계 결과

- 작성일: 2026-10-02
- 계획: [LegacyUIBoundary](../planning/2026-10-02-Database-LegacyUIBoundary.md).
- 상태: main App 연결 확인 및 최신 단위 검증 완료, 통합용 ready. 서버/계약/model/v1 raw 정책, domain/clipboard 및 NativeProjectView를 수정하지 않았다. git add/commit, 전체 format/check/build, progress 수정은 하지 않았다.

## 변경 파일

- 신규 `apps/web/src/features/tables/legacy-database-editor-policy.ts`: optional DB 문맥과 v1 호환 후보 경계를 정의했다. MySQL은 보수적인 기존 scalar 표현, SQLite는 integer/text/real/numeric만 신규 후보로 둔다. native type IDs/usable/coverage를 v1 타입 문자열로 매핑하지 않는다. 미전달/PG 호출은 기존 후보와 동작을 유지한다.
- 신규 `LegacyDatabaseEditorNotice.tsx`: 현재 값 보존 및 DB 전용 새 기능의 명시 native 업그레이드 안내. readonly/미연결 callback은 CTA를 비활성화한다. callback만 호출하고 POST/자동 업그레이드를 수행하지 않는다.
- `column-type-options.ts`: non-PG 신규 PG 전용 scalar/ENUM 배정을 제거하고 current unknown/PG-only/ENUM 값을 유지한다. 현재 ENUM이 목록에 없는 경우에도 원래 ID/표시를 유지한다. 원본 타입 객체는 변경하지 않는다.
- `column-defaults.ts`: optional DB kind를 받아 non-PG 신규 @auto(serial)/now()/gen_random_uuid() 후보를 제외하고 적용 함수도 같은 정책으로 막는다. 기존 raw default는 조회/표시/무관한 편집에서 유지하며 명시 해제/정상 후보 교체는 가능하다. 기존 명시 type 변경의 default 초기화 규칙은 유지한다.
- `TableEditor.tsx`: inline/detail/create 세 타입 경로와 handler, default 및 array 신규 활성화를 같은 DB 문맥으로 검사한다. 현재 array는 보존하고 해제할 수 있다. 원래 타입의 파라미터 편집과 현재 ENUM/raw 복구를 잠그지 않는다. inspector/default 안내와 inline context menu의 native CTA를 연결한다. ColumnEditor/ColumnCreationForm을 전용 handler 검증에 직접 소비하도록 export했다.
- `EnumDialog`는 non-PG 안내와 close→root request callback을 연결한다. `EnumManager.tsx`의 optional allowCreate만 추가하여 non-PG 새 프로젝트 ENUM 생성 form은 숨기고 기존 ENUM 편집·삭제 및 값을 유지한다. 기존 default allowCreate=true 호출은 그대로다.
- `Canvas.tsx`: optional DB/CTA props를 TableNodeContent/TableInspector/EnumDialog에 전달한다. domain CRUD, layout/geometry, copy/paste 구현은 변경하지 않는다.
- 신규 tests: `legacy-database-editor-policy.test.ts`, `legacy-database-editor-ui.test.ts`.

## App 인계 API

```ts
databaseKind?: DatabaseKind | undefined;
onRequestNativeUpgrade?: (() => void) | undefined;
```

- main이 기존 v1 Canvas 호출에 `databaseKind={opened.project.databaseKind ?? 'postgresql'}` 및 onRequestNativeUpgrade callback을 연결한 것을 실제 App 소스에서 확인했다. callback은 인자를 받지 않고 designReadOnly이면 반환한다.
- callback은 NativeUpgradeButton wrapper에 scrollIntoView한 뒤 `button:not([disabled])`의 첫 버튼에 focus만 한다. click/prepare/apply/POST/문서 전환을 직접 호출하지 않는다. 사용자의 후속 명시 버튼 조작은 기존 prepare/autosave/pending/actor/row-lock/replay/apply 경로를 유지한다. EnumDialog는 먼저 onClose 후 microtask에서 callback을 호출한다.
- optional props 미전달/PG 호환은 그대로이며, 현재 main root에서는 프로젝트의 실제 DB kind를 소비한다. profile/revision 조회·서버 권한 또는 capabilities native-v2 판정을 변경하지 않았다. App의 wrapper/ref/callback 변경은 main이 작성했으며 직접 수정하지 않았다.

## 검증과 한계

- targeted **68개 통과**: 신규 policy/UI handler 13개 + 기존 column-type-options/column-defaults/TableEditor 55개.
- main App 연결 이후 2026-10-02 19:49 KST에 같은 targeted **68개 재통과**, 담당 파일 Prettier check 통과. main App.tsx와 신규 tests를 진입점으로 하는 최신 source 별칭 transitive noEmit typecheck도 통과했다. 임시 config를 제거했다.
- MySQL/SQLite inline/detail/create handler의 PG 전용 신규 타입/ENUM 거부, 현재 opaque/PG/ENUM/array 원문과 default 유지·해제, 기존 ENUM 실제 값 수정, Canvas/inspector callback 전달, close 후 CTA 요청, readonly/미연결 비활성, PG/문맥 미전달 호환을 검증했다. 새 컬럼은 기존 v1 text factory를 사용하며 native payload를 합성하지 않는다.
- 최신 source aliases로 Canvas/TableEditor 및 신규 tests의 transitive noEmit typecheck 통과. 테스트는 직접 component hook/handler 소비 및 기존 static 렌더링을 사용했고 브라우저·실제 HTTP 저장을 이번 단위에서 실행하지 않았다. 실행 검증 완료/DDL native 기능 활성화로 주장하지 않는다.
- 변경 파일만 Prettier 적용/확인. 임시 typecheck config는 제거했다. 구현 착수 시 관련 v1 파일에는 선행 dirty 변경이 없었으며 App/다른 담당 파일은 직접 수정하지 않았다.
- 이 목록은 보수적인 v1 호환 UI 경계다. non-PG v1을 native로 업그레이드하면 기본 이름이 같더라도 기존 migration 정책에 따라 원문 legacy로 보존된다. native DB 타입 선택·새 DB 옵션·DDL은 명시 업그레이드 후 기존 native 경로에서 다룬다.
- main 최종 browser QA는 explicit v1 MySQL/SQLite의 inline/detail/create/default/ENUM 현재 값·upgrade CTA focus와 PG v1 회귀를 확인해야 한다. App 연결은 완료 확인했고, 실제 사용자 조작에 의한 upgrade 전환·브라우저 메뉴 QA는 main 담당이다.
