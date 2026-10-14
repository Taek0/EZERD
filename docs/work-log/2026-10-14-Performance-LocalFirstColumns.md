# 로컬 우선 컬럼 편집 1단계 구현

- durable intent에 보관한 컬럼 추가/이름 patch 명령을 서버 확인 문서 위에 순서대로 투영한다. snapshot/version/expected 및 서버 저장 Promise의 ACK 의미는 유지했다.
- 시각적 ACK bridge를 별도 namespace에 유지해 queue 소비와 App의 서버 문서 반영 사이에 값이 되돌아가지 않게 했다. 다음 로컬 명령은 이전 ACK 위에 남는다. bridge 저장 실패 시 메모리 bridge를 유지하며 원래 전송 intent를 변경하지 않는다.
- 같은 origin의 storage 변경 구독 및 초기 읽기로 보관 명령/bridge를 복구한다. actor/project/DB revision을 격리한다. 지원하지 않는 복합 명령은 부분 투영하지 않는다.
- 거부는 기존 rejected-intent/초안 보존 경로를 유지하면서 해당 로컬 투영만 제거한다. 모델 함수를 통해 원문을 변경하지 않고 투영한다.
- 캔버스/속성/탐색에서 투영 문서를 사용하고 로컬 반영/동기화 중 상태를 표시한다. 기존 카드 추가 미리보기는 동일 ID가 공유 투영에 나타나면 중복 없이 정리된다.
- 집중 21개 회귀 및 pnpm check(포맷/타입/전체 테스트/제품 빌드) 통과. 브라우저의 지연 ACK 시나리오는 후속 검증 기록에 남긴다.
- 이번 단계는 기존 localStorage intent + IndexedDB claim 구조를 유지하며, 모든 입력을 IndexedDB로 이관하는 변경이 아니다. 이름 자동저장 quiet window와 동일 폼의 전송 조율은 유지한다. 삭제/관계/타입 변경은 아직 공통 로컬 투영 대상이 아니다.

[계획](../planning/2026-10-14-Performance-LocalFirstColumns.md)
