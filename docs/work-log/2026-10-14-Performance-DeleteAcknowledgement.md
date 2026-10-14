# 삭제 저장 확인 후처리 개선

## 변경

- NativeDurableQueue는 mutate가 읽은 row를 그대로 반환한 no-op에서 IDB put/delete와 BroadcastChannel 쓰기 알림을 생략한다. readwrite transaction과 guard는 여전히 실행한다.
- ACK 항목 삭제 이후 endTransmission이 빈 row를 다시 delete하거나 다른 탭의 row를 다시 put하지 않는다. 실제 변경/ACK 삭제는 strict durability로 commit 완료까지 기다린다.
- NativeProjectView의 drain은 처리 결과를 전달한 후 로컬 waiter와 intent가 모두 비었으면 종료한다. 전송 종료/영속 정리는 이미 끝난 시점이며, 이후 요청은 기존 save 스케줄링/폴링 및 실제 전송 시 원자적 claim을 계속 사용한다.
- 앞선 동일 화면 구조 공유와 함께 사용한다. 저장 완료를 서버 ACK 이전에 표시하지 않는다.

## 실측

43테이블/436컬럼 실제 데이터 복제본, 동일 profiling 설정. 원본 문서는 수정하지 않았다. 값은 mock ACK gate 해제→`저장 기준 확인됨` DOM 확인이며 실제 네트워크/server latency를 포함하지 않는다. gate 해제 직후 mock 응답 구성 비용과 25ms DOM polling 오차는 포함한다.

- 기준: 344.4ms, React 합산 183.8ms.
- 최종 3회: 148.7 / 171.3 / 150.2ms, 중앙값 150.2ms.
- 최종 React 합산: 65.6 / 65.3 / 61.0ms, 중앙값 65.3ms.
- 로컬 삭제 표시 자체와 구분한 수치다. 서버의 실제 저장/검증 대기 시간은 이 변경으로 줄었다고 주장하지 않는다.
- 매회 최신 입력 보존·ACK 전 로컬 표시·삭제 유지·큐 비움 통과.

## 검증

- 집중 테스트 61개 통과: ACK 뒤 중복 delete 없음, 다른 탭 row를 불필요하게 put하지 않음, adopt no-op에서도 guard 실행/실패 보존, 기존 전송 claim/lease/recovery/거절/오프라인 회귀.
- 표시 문서 구조 공유의 실제 서버 값 변경 반영과 원본 요청 불변 회귀 포함.
- raw: lab artifacts/performance/2026-10-14-delete-ack/{before,after-1,after-2,after-3}.json.
