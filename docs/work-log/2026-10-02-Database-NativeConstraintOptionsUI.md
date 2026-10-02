# C7 FK·키·ENUM 옵션 UI 결과

- 계획: [NativeConstraintOptionsUI](../planning/2026-10-02-Database-NativeConstraintOptionsUI.md). 부모 c242db9 기본10 feature 활성/advanced23 false와 diagnostics2ab34f9 기준이다. 이 단위에서는 flags/model/contracts/sync/server/index/App를 수정하지 않았다. git add/commit 및 전체 check/build/browser/DB 실행은 부모 담당이다.

## 실제 컨트롤과 소비

- PG/SQLite FK, PG PK/UQ에 NOT DEFERRABLE/INITIALLY IMMEDIATE/INITIALLY DEFERRED 선택을 신규/기존 구조 form에 연결했다. PG UQ에는 NULLS NOT DISTINCT true/false를 연결했다. PK의 true 선택은 비활성화하고 조건 안내를 표시한다. MySQL FK 및 MySQL/SQLite key에는 신규 지연 옵션을 제공하지 않으며, 기존 미지원 설정은 disabled 상태로 원문을 보존한다.
- root `deferrable`과 `nullsNotDistinct`를 정확한 typed add/patch payload로 준비한다. 기존 옵션 무변경/명시 false/컬럼 매핑/이름 변경/기존 옵션 순서 및 ID를 유지한다. FK의 mapped 생성은 root 옵션을 add에, derived 생성은 create_foreign_key 뒤 같은 batch의 patch_foreign_key에 담도록 준비했다. 신규/변경 쓰기는 feature readiness와 전체 candidate 공통 inspector/write/native contract/raw size를 검사한다. candidate/원본을 previous로 지정하지 않는다.
- FK의 deferrableForeignKey 및 PG UQ의 nullsNotDistinct feature를 직접 소비한다. PK/UQ deferrability 전용 feature ID는 현재 없으므로 실제 PG 엔진 validator + primaryKey/unique 및 전체 write readiness를 소비한다. advanced23이 false인 현재 실제 신규 mapped/derived FK 및 key 옵션 저장은 계속 차단된다. enabled positive 저장/ACK/DB 실행의 증거로 계산하지 않는다.
- ENUM schema/name/values 입력은 이미 존재한다. 원문 이름/스키마와 label별 UTF-8 바이트 수, public 기본 namespace 및 공통 ENUM inspector/feature 진단을 추가했다. bytes는 UTF-16 문자 수로 환산하지 않는다. PG label/name/schema63byte, 중복/NULL 문자/namespace/name 충돌 등의 허용 여부는 실제 공통 정책을 사용한다. 다른 DB의 새 ENUM 메뉴는 비활성화했다.
- enum 배열 차원 입력은 현재 source builtin typeId를 새 enum 후보에 잘못 함께 전달하지 않고 현재 선택 타입·generation reset·strict facts로 판단한다. 명시 타입 변경/배열 변경이 generation을 none으로 reset하는 기존 builder와 같은 facts를 사용한다. 차원1…6/빈 값 제거 안내, PG만 신규 배열 입력, 빈 enum schema의 public 라벨을 연결했다. array/enum gates false를 승격하지 않았다.
- identity mode와 exact sequence start/increment/min/max/cache/cycle, MySQL ON UPDATE 함수/제거는 기존 실제 컨트롤이 있으므로 추가하지 않았다. 부모 core phrase4줄과 initialSelection/recovery 인터페이스를 보존했다.
- 후속 SRID 보완: MySQL geometry 파라미터는 제한 없음/0/4326 선택과 미검증 current 원문 보존 항목을 제공한다. 각 후보의 허용 여부는 공통 inspector의 설치 검증과 catalog 범위 검사를 소비하고, 신규 SRID 적용은 실제 srid feature usable로 차단한다. 미완성 숫자와 새999998 등은 저장되지 않는다. 기존999999의 무수정·nullable 변경은 해당 타입 원문을 그대로 유지하며 명시적인 SRID 제거는 기존 type reset 리뷰를 거쳐 준비한다. 부모 `native-editor-diagnostic.ts`의 type.srid-unverified 한·영 안내를 import하며 해당 파일은 수정하지 않았다.
- SRID helper는 해당 파라미터의 engine/readiness 판정용 probe다. logical 소유자의 mandatory physical payload도 clone에서 검사하여 scope 때문에 미검증 값 검사가 생략되지 않게 한다. 이 probe의 scope 변경은 실제 명령에 포함되지 않으며 이전 문서/후보를 trusted previous로 지정하지 않는다. 전체 적용 검증은 기존 서버 최종 candidate가 계속 담당한다.

## 계약·label 편집의 실제 제한

1. 현재 patch_key/patch_foreign_key 계약은 deferrable nullable/unset을 지원하지 않는다. 기존 지연 설정을 none으로 바꾸는 선택을 disabled로 표시하고 helper에서도 `native.deferrability-removal-contract-required`로 차단한다. 삭제·재생성이나 undefined를 JSON에서 누락시켜 제거했다고 처리하지 않는다. 부모가 제거 명령/nullable 계약과 inverse/history/server 소비를 마련하면 그때 UI 제거 경로를 연결해야 한다.
2. native ENUM/valueList 계약은 빈 문자열과 개행 label을 허용하고 서버/model도 이를 검사·보존한다. UI의 한 줄당 값 textarea는 정확한 편집을 표현하지 못하므로, 기존 empty/CR/LF label 목록은 disabled로 보존한다. 무수정·ENUM rename은 exact array 그대로이며, MySQL enum→set 명시 타입 변경에서 목록 입력 무변경이면 원래 배열을 복사한다. 목록 변경 요청은 `native.enum-structured-label-editor-required`로 차단한다. UI의 현재 편집 한계이며 backend가 해당 label을 금지한다는 의미가 아니다.
3. repeated raw label controls(순서/추가/삭제/빈 값/개행 각각의 구분)는 별도 후속이다. 신규 textarea로 단 하나의 빈 label을 표현하는 것도 현재 모호하므로 지원 완료로 계산하지 않는다. backend/MCP의 정확한 배열 입력은 이 UI 제한과 별개로 유지한다.
4. 활성화 뒤 부모 QA에서 FK mapped/derived 원자 저장과 root options ACK/replay, PK/UQ deferrability·NULLS ND, ENUM namespace/63byte/array 차원의 실제3DB 허용/거부·DDL 실행 및 브라우저 재열기를 확인해야 한다. key deferrability도 feature base gate 활성화만으로 전체 사용 증거를 대신하지 않는다.

## 검증과 파일

- actual model/contracts source alias의 ignored `.data/native-constraint-options.vitest.ts`: targeted5files **93개/skip0 통과**. 새16개 + 기존 structured UI11/option-policy40/format diagnostics11/advanced UI15개를 검사했다. policies/schema/coverage를 mock하거나 verified 값을 주입하지 않았다.
- 검사: PG PK/UQ timing, SQLite/PG FK vs MySQL 차단, PG UQ NULLS ND vs PK 거부, same-field removal 불가, typed partial payload·명시 false, rename source/order/mapping 보존, mapped/derived readiness 차단, 두 언어 실제 root form 연결, ENUM63/66byte 및64byte namespace/중복, 빈/개행 label 실제 native schema 허용 및 원문 보존, selected enum array facts, 타 DB 메뉴 차단.
- 담당 helper/control/test/structure/format5개 root files와 source dependencies TypeScript diagnostics0. 변경5개 코드 targeted Prettier 및 tracked diff whitespace 검사 통과. 실제 new advanced saving/엔진 DB fixture/browser positive는 수행하지 않았다.
- SRID3개 추가 검증: shared0/4326 allowed 및 현재 usable=false, unknown/incomplete/non-spatial/mandatory logical payload 차단, 원문 보존·nullable patch·신규 미검증/검증 대기 값 거부·명시 제거, 양 언어 선택 및 실제 NativeFormatEditor 연결. 후속 TypeScript diagnostics0/93tests를 다시 통과했다.
- 새 `apps/web/src/features/projects/native-constraint-options.ts`, `native-constraint-option-fields.tsx`, `native-constraint-options.test.ts`; 최소 연결 `native-editor-structure.tsx`, `native-editor-format.tsx`; 계획/이 작업 기록. diagnostics 단위의 다른 파일은 수정하지 않았다.
