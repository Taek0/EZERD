# C5 native DDL 방언 컴파일러

- 시작 `0edbd16`. 전체 native 물리 테이블/컬럼/ENUM/키/FK/index/CHECK를 수집하며 화면·도메인·참조 노드로 제한하지 않는다.
- PG/MySQL/SQLite의 식별자·리터럴·타입·AST·default/generation·테이블 옵션과 제약을 별도 SQL 직렬화 규칙으로 출력한다. legacy 원문을 SQL로 삽입하거나 PG SQL 텍스트를 치환하지 않는다.
- PG/MySQL FK는 모든 테이블 및 대상 unique 인덱스 생성 후 ALTER로 적용하고 SQLite FK는 테이블 내부에 선언한다. ENUM/스키마 의존 순서, computed 컬럼 참조, 전체 이름 충돌과 고유 제약/인덱스 이름을 검사한다.
- 엔진 검사 및 컴파일 fixture용 진입점과 제품 export의 readiness 검사를 분리한다. API/UI는 coverage gate를 통과한 export 진입점만 사용한다. 오류 시 SQL은 빈 문자열이며 부분 SQL 다운로드를 허용하지 않는다.
- 안전한 숫자/바이너리/typed 리터럴과 제한 AST만 렌더링한다. 환경 의존 collation/charset/SRID 및 SQLite 설명 SQL 주석은 결과 진단에 남긴다. MySQL 리터럴은 SQL mode 전제를 명시하며 따옴표/백슬래시/개행 입력을 검사한다.
- 타입·조합·전체 설계/순환 FK/주입성 문자열/legacy·미완성 오류 fixture와 실제 실행으로 확인한다. 해당 단위의 컴파일러 검사 뒤 공유 메뉴/REST·MCP/다운로드 및 전체 타입 UI 연결을 후속 단위로 진행한다. pure compiler 테스트를 실제 DB 실행 또는 제품 활성화 완료로 계산하지 않는다.
