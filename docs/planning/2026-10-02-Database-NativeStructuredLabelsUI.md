# Native ENUM·SET 개별 label 편집

- 선행: root 지침 및 native 계약을 읽었다. PG ENUM/MySQL ENUM·SET은 빈 문자열·개행 label을 담을 수 있고 native 배열은1000개/문자열10000자까지 표현한다. SET의64개/쉼표 금지, 중복/NUL/DB 길이/정렬 제약은 공통 정책이 판단한다.
- 구조 ENUM과 format valueList의 줄 분리 textarea를 개별 label 반복 컨트롤로 교체한다. durable record에는 JSON array를 직렬화한 string을 저장하고 strictparse한다. 순서·빈 값·CR/LF·공백·추가/삭제를 정확히 유지한다. 사용자에게 JSON 편집을 요구하지 않는다.
- malformed/과도한 JSON은 자동 복구·trim·filter하지 않고 원문 draft를 보존/차단한다. 기존 줄 형식 archive는 자동 split하지 않으며 값 변경이 있으면 명시 재입력을 안내한다. 값 무변경 command는 실제 저장 배열을 유지한다.
- NativeEditorForm의 before/revision/actor/project/expected coords/dirty/pending/export blocker를 재사용한다. nullable deferrable 제거는 Banach 계약 완료 전 기존 disabled 상태를 유지한다. model/server/contracts/readiness는 수정하지 않는다.
- helper/control/source tests 및 scope Typecheck/Prettier만 수행한다. git add/commit/전체 check/build는 하지 않는다.

## 2026-10-03 재개와 nullable clear

- 부모 nullable patch 계약 완료 후 NONE을 기존 객체의 deferrable:null clear로 연결한다. stored object는 optional 속성을 유지하고 null을 저장하지 않는다. fresh NONE/omission은 그대로 유지하며 explicit undefined는 계약에서 거부된다. MySQL 등의 미지원 원문 설정도 none 복구는 가능하고 신규 지연 설정은 계속 차단한다.
- 부모 readiness 후보 실제 활성화에 맞춰 담당 default/key/index/tree 테스트를 positive 명령·실제 usability로 갱신한다. unsupported·미완성 입력·원문 보존 검사는 유지하고 flags/previous를 위조하지 않는다.
- 결과는 현재 날짜 2026-10-03 작업 기록에 작성한다. 기존 계획 링크는 유지한다.

- 최종 결과: [2026-10-03 작업 기록](../work-log/2026-10-03-Database-NativeStructuredLabelsUI.md).
