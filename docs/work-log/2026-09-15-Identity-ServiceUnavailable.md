# 사용자 접속 503 원인 확인

작성일: 2026-09-15

현재 API는 동일 username/PIN에 대해 기존 사용자 행을 반환하는 upsert 코드를 사용한다. 확인된 503은 그 중복 처리 실패가 아니라 DB 연결 실패다.

- API 127.0.0.1:3001과 Vite 127.0.0.1:5173은 실행 중.
- 앱 설정의 DB는 127.0.0.1:15432/ezerd이며 해당 포트 listener가 없다.
- 동일 설정의 PostgreSQL SELECT 1 연결 시 ECONNREFUSED 발생.
- GET /api/users 및 GET /api/health/ready 모두 HTTP 503.
- docker ps는 dockerDesktopLinuxEngine named pipe 부재로 실패. 현재 프로젝트 DB를 구동할 Docker 엔진이 사용 불가능하다.
- databaseOperation이 미처리 저장소 예외를 ServiceUnavailableException으로 변환해 사용자에게 503을 반환한다.

Docker가 현재 사용 불가능한 구체적인 종료 원인까지 이번 확인으로 확정하지 않았다. 과거 소켓 오류 재발이라고 단정하지 않는다. 사용자 데이터·DB 스키마·서비스 상태는 변경하지 않았으며 초기화도 수행하지 않았다. 진단 문서만 기록했다.
