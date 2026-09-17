# 타입별 기본값 UI 최종 확인

기존 timestamp 컬럼에서 현재 시각 now() 선택, INTEGER로 변경할 때 기본값 초기화, 고정 기본값1 선택, 자동 증가 선택 후 SERIAL/NOT NULL/자동 증가 표시를 메모리 API fixture에서 확인했다. 자동 증가는 고정 DEFAULT1을 저장하지 않는다.

실제 DB 쓰기는 없으며 단위338개·전체 타입/포맷/빌드 검증이 통과했다. 시간 DEFAULT와 SERIAL 등 SQL 표현은 모델 테스트로 검증했고 실제 PostgreSQL DDL 실행은 이번 작업에서 수행하지 않았다. 임시 UI fixture와 QA 서버·탭은 정리한다. 429 오류는 발생하지 않았다.
