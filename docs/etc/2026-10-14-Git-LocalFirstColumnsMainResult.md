# 로컬 우선 컬럼 편집 main 반영 결과

- 기존 작업은 원격 main 1923704까지 push 완료했다.
- 새 제품 커밋 fbbc0d5 → 51ba4ad, 9e80426 → 2dce77d를 로컬 main에 충돌 없이 선별 반영했다. 계측 도구는 제외했다.
- pnpm check 성공: 2,910 passed / 499 skipped, 244 files passed / 26 skipped. 포맷/타입/제품 빌드 통과, 기존 번들 크기 경고는 남아 있다.
- 지연 ACK 브라우저 fixture에서 선반영, 나중 이름 유지, 실제 컬럼 추가 버튼의 ACK 전 표시, 최종 중복 없음/큐 비움 확인.
- 저장 큐에 보관된 컬럼 추가/물리·논리 이름 변경을 지원한다. 같은 폼의 기존 전송 조율과 750ms 자동저장 대기는 유지되며 삭제/관계/타입 변경의 공통 선반영은 후속 범위다.
- localStorage intent + IndexedDB claim 구조를 유지한다. 서버 Promise는 실제 ACK까지 기다리는 의미를 유지하되 화면은 투영으로 먼저 반영한다.
- localhost 정적 빌드가 갱신됐으므로 새로고침 후 사용할 수 있다. 새 로컬 우선 기능 커밋은 원격 push하지 않았다.

[계획](2026-10-14-Git-LocalFirstColumnsMainPlan.md)
