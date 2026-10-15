# 서버 저장 개선 main 통합 결과

- 요청된 기존 삭제 개선은 origin/main 2527365로 push 및 원격 일치 확인 완료.
- 신규 서버 제품 커밋: 86cab2c. 중복 입력 파싱, 트랜잭션 내 신규 baseline 재조회, 검증된 ACK 문서의 이벤트 재파싱을 줄였다.
- main `pnpm check` 통과: 2,931 passed / 499 skipped, format/type/build 정상.
- 별도 격리 DB integration 200개 통과. 실제 DB/HTTP 복제본 실측에서 삭제 POST 중앙값 466.21→379.37ms, 이름 391.04→336.74ms, 추가 460.65→326.31ms, 10개 속성 453.29→352.07ms.
- 계측과 원시 CPU/SQL 자료는 performance-lab에 유지했다. 사용자 원본 문서는 변경하지 않았고 임시 데이터/DB는 정리했다.
- 새 서버 개선은 로컬 main에만 커밋했고 아직 push하지 않았다. 현재 실행 중인 서버를 재시작해야 적용된다. DB migration은 없다.
