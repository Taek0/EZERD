# 로컬 우선 컬럼 편집 1단계 계획

- 원격 main 1923704 push 완료 후 시작. 기존 혼합 durable 구조(localStorage 불변 intent + IndexedDB 전송 claim)를 유지한다. 이번 단계는 저장 매체 전면 교체가 아니다.
- 지원 범위는 컬럼 추가 및 물리/논리 이름 patch 명령이다. 저장 큐에 보관된 명령을 서버 확인 문서 위에 순서대로 투영하여 ACK 전에 캔버스/속성/탐색에 표시한다. 이름 입력 자체의 기존 자동저장 quiet window는 유지한다.
- 서버 저장 Promise는 ACK 의미를 유지한다. 화면 선반영을 위해 성공을 조기 반환하지 않는다. snapshot/expected/version을 조작하지 않는다.
- ACK를 받은 명령은 그 sequence가 서버 문서에 반영될 때까지 시각적 bridge로 유지한다. 나중에 입력한 명령은 앞선 ACK 위에 다시 투영한다. 거부는 해당 투영만 제거하고 기존 rejected intent/초안 보존 경로를 유지한다.
- 복구/탭간 storage 변화/actor·project·DB revision 격리/불변 원문/중복 추가/지원하지 않는 batch/저장 실패를 검증한다.
- 삭제/관계/타입 변경의 공통 낙관적 반영은 후속 범위다. 기존 단일 카드 추가 미리보기와의 중복을 방지한다.
