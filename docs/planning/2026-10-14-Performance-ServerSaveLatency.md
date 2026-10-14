# 서버 저장 대기 시간 개선 계획

- 기존 삭제 개선은 origin/main 2527365로 push 및 원격 HEAD 일치 확인 완료.
- 실제 데이터 복제본을 별도 로컬 서버/임시 프로젝트에서 저장하며 HTTP, SQL, CPU profile을 측정한다. 사용자 원본 문서는 수정하지 않는다.
- 명령 처리/동기화 검증에서 반복되는 파싱·비교·조회 중 증명 가능한 중복만 제거한다. 권한 확인, row lock, immutable replay, database revision, retired identity, raw/normalized 비교와 서버 검증을 유지한다.
- 기존 전체/경량 응답 및 REST/MCP/취소/동시 편집 격리 통합 회귀를 확인하고 측정 결과와 한계를 work-log에 기록한다.
