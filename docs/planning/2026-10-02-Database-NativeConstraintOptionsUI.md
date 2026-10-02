# C7 FK·키·ENUM 옵션 UI 보완

- 기준: root AGENTS, 기능 명세/TypeFeatureMatrix, 현재 진행 기록 c242db9의 기본10 feature 활성/advanced23 false. 구조/format/계약/공통 validator를 먼저 읽었다. model/contracts/server/sync는 읽기만 한다. git add/commit은 부모 담당이다.
- PG/SQLite FK 및 PG PK/UQ의 DEFERRABLE INITIALLY IMMEDIATE/DEFERRED 입력, PG UQ NULLS NOT DISTINCT 입력을 신규/기존 구조 form에 연결한다. FK/키 root 옵션을 정확한 typed command/부분 patch로 준비하며 원래 필드·명시 false를 보존한다. 파생 FK는 생성 명령 뒤 같은 batch의 옵션 patch로 준비한다.
- 공통 inspector/feature/write 판정을 소비하며 flags를 바꾸지 않는다. key deferrable의 별도 feature registry가 없으므로 PG 엔진 허용과 해당 primaryKey/unique readiness 및 전체 write 판정을 사용한다. unsupported DB나 PK의 NULLS NOT DISTINCT는 명시 차단한다.
- 기존 patch 계약은 deferrable 제거를 나타낼 nullable/unset 필드가 없다. existing deferrable을 none으로 변경하는 입력은 삭제·재생성을 추정하지 않고 차단/안내하며 부모 계약 후속으로 기록한다.
- ENUM schema/name/labels는 이미 입력 가능하므로 원문 UTF-8 byte counts와 공통 validator 진단을 추가한다. 다른 DB에서는 ENUM 신규 메뉴가 활성화되지 않게 한다. enum 배열 차원 입력은 현재 선택 타입과 정확한 feature facts로 판단한다. identity sequence/ON UPDATE 세부 입력은 기존 구현을 유지한다.
- 부모가 커밋한 structure core phrase4줄 및 현재 diagnostics 변경을 보존한다. 새 helper/controls/tests 중심으로 최소 연결한다. 실제 policies/schema에 대한 targeted tests·source Typecheck·targeted Prettier만 실행한다. advanced enabled/API/DB/browser QA는 부모 activation 뒤의 증거다.
- 후속 label 검토: native 계약/validator는 빈 문자열 및 개행을 포함한 ENUM/valueList label을 허용한다. textarea가 해당 원문을 다시 분리하지 않도록 기존 값 무수정/이름 변경은 보존하고, 해당 목록 편집은 UI/helper에서 명시 차단한다. MySQL valueList의 명시 타입 변경에서도 목록 입력이 그대로이면 원래 배열을 사용한다. backend 허용 범위는 좁히지 않으며 정확한 repeated-label 편집은 별도 후속 단위다.
- 후속 SRID 소비: 부모 공통 validator의 신규0/4326 허용 및 type.srid-unverified 진단을 사용한다. 공간 파라미터는 후보를 공통 inspector로 검사해 선택지/이유를 계산하며 srid feature usable을 그대로 소비한다. 미검증 현재 숫자는 원문으로 보존하고 신규 쓰기는 차단한다. 부모 진단 helper는 수정하지 않는다.
- 결과: [작업 기록](../work-log/2026-10-02-Database-NativeConstraintOptionsUI.md).
