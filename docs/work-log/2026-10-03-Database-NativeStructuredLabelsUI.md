# Native structured labels·nullable clear UI 결과

- 계획: [NativeStructuredLabelsUI](../planning/2026-10-02-Database-NativeStructuredLabelsUI.md). 2026-10-02 착수 WIP를 2026-10-03 재개하여 완료했다. 기존 계획 링크를 유지했다. 부모 registry 활성화 후보와 nullable patch 계약의 최신 source를 소비했다.
- None/current 표시 후속: 기본값 none은 한·영 기본값 없음/No default로, 보존 current는 현재값 유지/Keep current value로 표시하며 recovery 자체에 검증 미완료 문구를 붙이지 않는다. 실제 unsupported/environment/input 조건 안내와 정책·저장 권한은 보존한다. 부모 key policy ready code 분기 파일은 수정하지 않았고, structure 후보 표시는 code가 있을 때만 nativeEditorConditionText의 plain 조건 안내를 표시하며 undefined/빈 괄호/raw code는 출력하지 않는다.
- 담당 UI·helper·tests 외 production model/registry/contracts/server/sync/NativeView/App를 수정하지 않았다. 부모 QA 서비스·UUID·browser final tab은 접근하지 않았다. git add/commit/전체 pnpm check/build는 하지 않았다.

## Exact label 편집

- PG project ENUM 및 MySQL ENUM/SET은 개별 multiline label 컨트롤과 순서 이동·추가·삭제를 사용한다. 빈 목록과 한 개의 빈 문자열을 구분하며 CR/LF·공백·Unicode·따옴표·역슬래시를 원래 문자열 배열로 보관한다. 추가는 명시적인 빈 항목을 만들고 중복을 자동 제거하지 않는다.
- durable record의 enumLabelsJSON/labelsJSON은 JSON array를 직렬화한 string이다. parser는 배열·string element·1000개·각10000자·raw 문서 budget을 검사한다. trim/filter/newline split/coercion을 하지 않는다. 제품 UI에는 JSON 입력을 노출하지 않는다. SET은 신규 항목 추가64개 상한과 쉼표 제한 안내를 제공하고 oversized repair draft를 자동 잘라내지 않는다.
- malformed/과도한 JSON은 원문 그대로 보존하며 변경·저장을 차단하고 기존 reset/retry를 안내한다. untouched enum rename은 label draft를 다시 parse해서 배열을 교체하지 않는다. 기존 줄 형식 archive는 자동 split하지 않고, 편집된 legacy text가 있으면 explicit reset/review 전까지 차단한다. before/current 저장 배열이 있는 무변경 command는 실제 배열을 보존한다.
- PG63byte/중복/NUL 및 MySQL charset·255단위 길이·trailing space·collation 동등/미검증·SET64/쉼표 제한은 계약과 공통 inspector를 소비한다. MySQL positive 개행/Unicode 조합은 실제 공통 정책에서 허용하는 utf8mb4_bin 조건으로 검증했다. _ci의 미검증 복합 label은 차단한다. 서버의 label 허용 범위를 UI에서 축소하거나 임의로 승격하지 않았다.
- valueList 변경은 기존 type-reset review 및 default/generation/ON UPDATE 처리 분기를 유지한다. NativeEditorForm의 actor/project/revision/before/expected version·sequence·DB revision·dirty·pending/export blocker를 그대로 사용한다. 새 요청 또는 별도 queue는 만들지 않았다.

## Nullable NONE clear

- 부모 계약에 맞춰 기존 key/FK에서 NONE을 선택하면 typed patch의 deferrable:null을 만든다. 후보 저장 객체에서는 해당 optional 속성을 삭제하고 null을 저장하지 않는다. omission·fresh NONE은 속성을 추가하지 않으며 explicit undefined는 실제 공개 계약에서 거부된다.
- PG PK/UQ 및 PG/SQLite FK의 clear를 연결했다. MySQL 등의 미지원 이전 root timing도 NONE으로 복구할 수 있고 신규 지원하지 않는 timing 선택은 비활성화한다. null clear에는 신규 deferrableForeignKey feature 사용을 요구하지 않지만 base feature/최종 candidate 검사는 유지한다.
- 신규 mapped/derived NONE은 add/create만 준비하며 null patch를 덧붙이지 않는다. timing 지정 derived 생성은 기존 같은 batch 후속 patch 경로를 유지한다. 기존 sparse old-root에서 새 UI metadata가 없으면 omission이 속성을 유지하고 explicit NONE만 제거한다. 이름·logical/physical 매핑·명시 false·root ID와 순서는 보존한다.

## Activation expectations

- 부모의 실제 활성화 후보에 맞춰 constraint16, structured UI11, option-policy40 및 index/tree tests의 old false-gate 기대를 positive 정책·exact prepared commands로 갱신했다. unsupported·미완성 literal·미검증 SRID·array/opclass·손상/예산·readonly·원문 보호는 유지했다. coverage flags나 current/candidate를 trusted previous로 위조하지 않았다.
- PG/MySQL/SQLite index union, PG array GIN, 복합 default/CHECK, exact bigint/identity/ON UPDATE 등의 실제 정책 소비를 검사한다. 기존 complex computed fixture의 allowed=true/usable=false 상태는 유지했다. 이 fixture를 지원하는 것으로 바꾸기 위해 데이터를 교체하거나 flags를 위조하지 않았다.
- 부모 제공 engine prepared77/API77 REST+MCP/SQL154 3DB 증거는 부모의 검증이다. 이 단위는 helper/control/source 검증이며 자체 실제 browser click·DB 저장·ACK roundtrip 증거로 계산하지 않는다. NONE enabled selection와 해당 선택값의 command semantics를 실제 component static markup/public helpers로 검사했다. 부모 browser final QA에서 실제 클릭/저장/재열기를 확인한다.

## 최종 검증

- ignored .data/native-structured-labels.vitest.ts의 실제 model/contracts source alias: targeted9files **147 PASS / skip0**. label16 + clear8 + constraint16 + structured UI11 + option-policy40 + format diagnostic12 + durable draft6 + advanced policy22 + tree16.
- 검사: exact array roundtrip/empty/list order/add/remove/CRLF·Unicode, malformed/과도한 raw input, PG add/patch 및 MySQL enum/set exact typed payload, explicit type-reset review, 실제 charset/collation 제한, legacy archive 보존, actor 격리·before/counter·DB context rebase, nullable wire token·undefined 거부·fresh omission·mapped/derived·old-root 및 stored optional 속성 삭제.
- 담당14개 root files와 actual source dependencies TypeScript diagnostics0. targeted Prettier 및 tracked diff whitespace 검사는 최종 확인했다. 전체 check/build는 부모가 수행한다.

## 파일 목록

- 새: apps/web/src/features/projects/native-label-draft.ts, NativeLabelFields.tsx, native-label-draft.test.ts, native-constraint-clear-ui.test.ts.
- 기존 소비: native-editor-structure.tsx, native-editor-format.tsx, native-constraint-options.ts, native-constraint-option-fields.tsx.
- 테스트 기대 갱신: native-constraint-options.test.ts, native-editor-ui.test.ts, native-editor-option-policy.test.ts, native-editor-format-diagnostic.test.ts, native-advanced-policy.test.ts, native-expression-tree-policy.test.ts.
- 기존 계획과 이 결과 문서. 부모 production registry/model 및 diagnostics 파일의 변경은 포함하지 않는다.
