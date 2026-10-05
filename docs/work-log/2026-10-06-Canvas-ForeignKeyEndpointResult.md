# 관계 끝점과 물리 FK 정의의 Native 저장 복구

- 계획: [ForeignKeyEndpointPlan](../planning/2026-10-06-Canvas-ForeignKeyEndpointPlan.md).
- native FK patch가 sourceTableId/targetTableId를 허용한다. physical 생략은 원문을 유지하고, null은 기존 모델의 canonical 값(null)으로 물리 정의만 제거한다. 관계 ID·논리 이름/설명/카디널리티와 미편집 데이터는 유지한다.
- 물리 정의를 다시 추가할 때 partial 입력만으로 불완전한 정의를 생성하지 않고 전체 physical 스키마로 검증한다. 기존 정의의 갱신은 공급된 필드만 병합한다. undefined와 임의 추가 필드는 허용하지 않는다.
- 서버 최종 locked candidate의 키/컬럼 owner·타입/DB capability·legacy·retired identity 검증 및 replay 순서는 유지한다.
- 격리 실제 HTTP 검사에서 세 DB 모두 FK 대상 변경+대응 컬럼 저장, 요청 replay, 잘못된 대상만 변경 시 rejected ACK와 문서/프로젝트 version 불변, physical:null 저장과 전체 physical 재추가가 통과했다. 기존 그룹/개인 상태/삭제 검증도 함께 통과했다.
- HTTP 201은 작업 ACK를 기록했다는 뜻이며 rejected ACK도 201이다. rejected 작업은 sequence/updatedAt을 기록하지만 설계 원문과 프로젝트 version을 변경하지 않는다. 테스트는 이 계약을 정확히 확인한다.
- strict patch 계약·후보 준비의 순수 회귀를 추가했다. 테스트를 실제 브라우저 조작이나 SQL 엔진 DDL 실행 검사로 표현하지 않는다.
- 이 단위는 서버/계약 연결이다. Native 관계 편집 폼의 끝점·대응 컬럼·정의 제거/추가 UI는 별도 통합 단위에서 연결하며 최종 전체 검사로 확인한다.
