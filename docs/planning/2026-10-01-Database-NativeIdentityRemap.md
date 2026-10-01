# C2g native 참조 ID 재매핑

- 시작 `7658685`, 작업 트리 깨끗함. clipboard/restore/전송 소비를 위한 순수 모델 단위다.
- 명시한 entity ID mapping과 별도 node ID mapping을 사용해 모든 native 컬렉션과 참조를 재매핑한다. DB/profile, SQL 타입 ID·이름·주석·리터럴 및 legacy 원문은 그대로 보존한다.
- generated/default/onUpdate/index parts·predicate·include/CHECK AST의 컬럼, ENUM, key/FK, domain/view/note/layout/route 참조를 빠뜨리지 않는다. 외부 참조는 caller가 허용한 retained ID만 사용할 수 있다.
- 선언 ID의 mapping 누락/중복/예약 ID, entity-node 대상 충돌과 누락 참조를 거부한다. node ID는 entity와 별도 mapping을 가져 원본의 같은 문자열 ID도 구분한다.
- 이 mapper는 clipboard의 새 legacy 복제를 허용하는 권한이 아니다. clipboard consumer는 legacy·서로 다른 DB/profile을 별도로 차단하고 전체 후보/예산/대상 모드를 검사한다. server restore는 저장 history와 provenance를 검증한 뒤 사용한다.
- 참조 종류별 remap, 숫자/리터럴/legacy 원문 보존, 외부 참조 허용 범위, missing/duplicate mapping, 원본 보존을 검증하고 독립 커밋한다. live v2는 열지 않는다.
