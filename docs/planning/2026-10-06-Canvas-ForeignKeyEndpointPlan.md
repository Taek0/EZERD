# 기존 관계 끝점·물리 정의 편집의 Native 저장 연결

- 전체 복구 대조 R04에서 Native 패널은 컨트롤을 준비했지만 기존 patch 계약이 sourceTableId/targetTableId 변경과 physical:null을 차단하는 것을 확인했다. UI만 활성화한 상태를 완료로 간주하지 않는다.
- 기존 관계 ID와 논리 의미를 유지하며 PK/FK 테이블·대응 컬럼을 함께 변경할 수 있게 계약과 후보 생성기를 확장한다. physical 생략은 보존, null은 명시적 삭제, undefined는 삭제 토큰으로 받지 않는다.
- 물리 정의가 없는 관계에 다시 정의를 추가할 때 전체 physical 형태를 검증한다. FK 타입/키/owner/reference/DB capability와 locked previous 검증은 기존 서버 최종 후보 검증을 유지한다.
- 잘못된 끝점/컬럼 교환의 전체 취소, 같은 요청 replay, 논리 내용과 관계 ID 보존을 단위·실제 세 DB HTTP 검사로 확인한다.
