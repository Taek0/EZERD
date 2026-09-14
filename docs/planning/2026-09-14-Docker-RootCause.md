# Docker 起動 오류 근본 원인 조사 계획

- Docker 시작·종료 로그와 Windows 버전, 소켓 reparse tag, 포트 예약 정보를 읽기 전용으로 조사한다.
- Docker 및 Microsoft 공식 자료와 대조하여 확인 사실과 추정을 구분한다.
- 실행 중인 엔진과 DB를 중단하거나 소켓을 변경하지 않는다.
- 결과, 근거, 남은 불확실성과 재발 대응을 work-log에 기록한다.
