# FK 끝점·물리 정의 인스펙터 연결 계획

- 부모의 [Native 끝점 저장 확장 계획](2026-10-06-Canvas-ForeignKeyEndpointPlan.md)에 맞춰 R04의 마지막 frontend 연결을 완성한다.
- sourceTableId/targetTableId와 physical:null을 기존 constraint draft/Native patch로 전달한다. 물리 추가·재활성화는 완전한 name/paired columns/onDelete/onUpdate 정의를 보내고 기존 정의의 미편집 legacy 값은 보존한다.
- 끝점·매핑 변경은 mapping review를 초기화하고 추가/끝점 변경 시 정확한 대응을 확인한다. FK capability, 물리 owner, 쌍 수·중복·컬럼 소속 검증을 유지하며 PK/type 호환성의 최종 권한은 locked server candidate에 둔다.
- contracts/server/model 및 부모 Canvas는 수정하지 않는다. frontend focused tests/typecheck/파일 포맷을 확인하고 별도 work-log와 독립 커밋을 남긴다. 브라우저/전체 check/실데이터 검증은 부모 범위다.
