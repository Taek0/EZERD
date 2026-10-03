# PostgreSQL native 대표 브라우저 QA

- 전용 loopback3138(불가 시3145) 및 작업 소유 UUID DB/harness/계정을 사용한다. 부모3139/qaFinalTab 및 Aristotle3143/3144를 접근·수정하지 않는다. production source는 읽기만 하고 제품 버그는 부모에게 보고한다.
- 현재 web/server/model/contracts 빌드로 정상 로그인한 own browser tab에서 PG native 프로젝트→물리 table/integer column→project ENUM empty/newline/Unicode 개별 controls→가능한 schema/array→PK 또는 UQ deferrable→NONE clear→whole SQL 다운로드를 실행한다.
- own DB의 project/version/sequence/revision/document/ledger를 읽어 UI 저장 exact array와 optional clear를 확인한다. 실제 다운로드 파일을 별도 작업 소유 scratch namespace/DB에서 PG transaction으로 실행·metadata/값/롤백을 확인한다. API로 UI 편집을 우회하지 않는다.
- 인증 storage/token을 브라우저에서 읽거나 주입하지 않는다. 다운로드 원본 및 타 작업 listener/DB는 삭제하지 않는다. 화면 캡처에는 테스트 데이터만 남기며 local credentials/session 값은 결과 문서에 기록하지 않는다.
- 완료/실패 시 own app/listener/pools/UUID DB를 정리하고 현재 날짜 work-log에 결과·한계를 기록한다. git add/commit 및 전체 build/check는 수행하지 않는다.
