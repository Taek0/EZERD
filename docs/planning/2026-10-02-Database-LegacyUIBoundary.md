# v1 DB 타입·기능 UI 경계 구현 계획

- 작성일: 2026-10-02
- 선행 감사: [LegacyUIAudit](../work-log/2026-10-02-Database-LegacyUIAudit.md).
- 범위: 신규 legacy UI policy/안내/tests, TableEditor/type/default/EnumDialog 및 Canvas optional props 전달. ENUM 기존 편집을 보존하기 위한 EnumManager의 optional allowCreate만 함께 연결한다. App은 main 담당. 서버/계약/model/v1 raw 정책/domain/clipboard 코드는 변경하지 않고 git 작업과 전체 check/build/format은 하지 않는다.

## 결정

1. optional databaseKind와 onRequestNativeUpgrade를 Canvas→inline/detail/create/default/ENUM 경로에 전달한다. 미전달/PG 호출은 기존 동작을 유지한다.
2. non-PG v1은 보수적인 공통 scalar 기존 표현 후보만 제공하고 현재 unknown/PG-only/ENUM 타입은 현재 값으로 유지한다. native catalog를 v1 name으로 매핑하지 않는다. PG 전용 신규 선택·project ENUM 생성/새 배정·array 신규 활성화·PG 전용 default/serial 증가에는 업그레이드 안내를 제공한다.
3. 기존 타입/ENUM/array/default는 삭제하거나 정규화 규칙을 변경하지 않는다. scalar 교체·기존 파라미터/default 해제·기존 ENUM 편집/삭제를 유지한다. 타입을 명시 변경하면 default를 초기화하는 기존 동작을 유지한다.
4. callback이 없거나 readonly이면 CTA를 비활성화한다. ENUM dialog CTA는 dialog를 닫은 후 root callback으로 이동한다.

## 검증

- non-PG inline/detail/create/default/ENUM 후보와 handler, 현재 unknown/alias/parameters/array/enum/default 보존, PG·문맥 미전달 호환, readonly·callback 전달.
- 기존 v1 targeted 회귀, 담당 source noEmit typecheck 및 변경 파일 Prettier. main이 App callback과 browser QA를 연결한다.
