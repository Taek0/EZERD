# 서버 저장·ACK 반영 및 컬럼 메뉴 지연 조사 결과

## 실행 범위

- 요청한 원격 main push 완료: b5965fa, local/remote HEAD 일치 확인. 이후 제품 코드는 변경하지 않았다.
- 실제 localhost:3001 Chrome이 index-i0R1Kasm.js를 사용함을 확인했다. 최신 버튼 렌더 최적화가 들어간 빌드다. 41개 테이블, DOM 9,857개였다.
- lab 기본 DB(127.0.0.1:55432)는 중지되어 연결 실패했다. main .env의 DATABASE_URL만 프로세스 메모리로 읽고 loopback DB 여부를 검사하여 별도 Nest 서버를 임의 loopback 포트에 실행했다. 설정 파일/기존 문서는 변경하지 않았다.
- 고유 테스트 사용자·워크스페이스·프로젝트를 생성하고 생성한 ID만 finally에서 정리했다. 합성 10/50/100 테이블 × 10 컬럼, 이름 변경/새 컬럼 추가/그 컬럼 삭제, 각 warmup 1회 + 측정 3회. 36건 accepted 및 ACK 반영 확인, 정상 종료/정리 완료.

## 실제 HTTP 저장 (반복 중앙값, ms)

| 규모 | 동작 | HTTP 왕복 | SQL 누적 | SQL 횟수 | ACK 크기 |
| --- | --- | ---: | ---: | ---: | ---: |
| 50 테이블 | 이름 수정 | 191.7 | 48.6 | 20 | 263,533 B |
| 50 테이블 | 컬럼 추가 | 194.4 | 47.5 | 20 | 264,009 B |
| 50 테이블 | 컬럼 삭제 | 192.6 | 49.3 | 22 | 263,608 B |
| 100 테이블 | 이름 수정 | 398.2 | 84.1 | 20 | 526,504 B |
| 100 테이블 | 컬럼 추가 | 416.2 | 86.2 | 20 | 526,980 B |
| 100 테이블 | 컬럼 삭제 | 423.8 | 92.9 | 22 | 526,579 B |

- 단일 변경에도 전체 문서가 요청 처리의 baseline/candidate 검증·fingerprint·diff 및 DB JSON 저장·ACK에 사용된다. prepareNativeSyncCandidate는 입력/현재/신뢰 baseline/후보 검증을 수행한다. 확인된 기능을 안전성 검증 없이 제거하면 안 된다.
- SQL 누적은 드라이버 query promise 구간이며 DB 엔진 CPU만 뜻하지 않는다. HTTP/서버/SQL은 포함 관계이므로 합산하지 않는다.
- 프런트와 같은 사전 operation lookup GET도 별도 측정했다(상세 raw 참조). 실제 브라우저 durable queue/IndexedDB/경합 대기는 이번 HTTP 드라이버에 포함하지 않는다.
- Node에서 nativeEntryAfterAck 계산은 50 테이블 약 9~14ms, 100 테이블 약 31ms였다. 이 수치는 React 렌더/paint와 별개다.

## 브라우저 ACK 재생

- 쓰기 차단 fixture에서 NativeProjectView에 단일 이름 변경을 담은 유효한 전체 문서 ACK를 재생했다. 실제 App처럼 nativeEntryAfterAck 후 startTransition으로 다음 entry를 반영했다. DOM에 새 이름이 반영될 때까지 기다린 후 추가 250ms 관찰했다.
- 50 테이블에서 React actualDuration 합계 724.5/770.6/894.1ms, NativeAdvancedEditor subtree 557.8/594.2/729.0ms, NativeERDCanvas subtree 136.4~149.1ms. 포함되는 subtree끼리 합산하지 않는다.
- ACK 때 document/snapshot 참조가 바뀌어 행 memo가 무효화된다. 행 50개 및 편집 셀 1,550개가 다시 실행됐다. 앞선 UI 선택 최적화는 문서 불변 상태에 효과가 있었지만 저장 ACK 경로까지 해결한 것은 아니다.
- 고급 인덱스·식 영역은 접혀도 마운트되어 있다. NativeAdvancedIndexForm은 disabled 판정과 상태 표시 등에 evaluate를 사용하며, nativeIndexCandidate의 후보 검증은 전체 문서 검증으로 이어진다. snapshot 변경 시 고급 편집기 memo가 무효화되면서 이 비용이 다시 발생한다.
- 위 값은 React profiling 작업량이고 입력→픽셀 표시/INP가 아니다. 실시간 서버의 ACK와 합성 브라우저 재생은 별도 실행이므로 단순 합으로 사용자 체감 시간을 확정하지 않는다.

## 우클릭 메뉴

- 최신 제품의 합성 문서 우클릭(contextmenu 이벤트)에서 메뉴 출현/문서 불변을 확인했다. 반복 React 시간은 1.6~2.3ms, menu items/policy 계산은 약 0.1~0.3ms였다. 행/편집 셀 전체 재실행은 없었다.
- 따라서 메뉴 단독 CPU 지연은 이 조건에서 재현하지 못했다. 사용자 현상을 부정하는 결과가 아니다. ACK의 무거운 작업과 중첩된 입력 대기 또는 실제 문서/paint 차이를 추가 확인해야 한다.
- rAF callback 누락이 계속되어 실제 메뉴 표시 시간은 확정하지 않았다.

## 우선순위

1. 닫힌 고급 편집기의 불필요한 candidate 평가를 제거한다. 최초 열기 지연 마운트, 열린/편집 중 초안·자동저장·복구 보존 및 평가 결과 재사용을 검증한다.
2. ACK 후 무관한 카드까지 문서 전체 참조 변경을 전파하지 않도록 구독/props 경계를 분리한다. snapshot 권한·저장 기준을 오래된 값으로 고정하는 comparator는 금지한다.
3. 서버의 중복 전체 문서 검증/직렬화와 baseline 저장 비용을 줄일 수 있는 신뢰 경계를 설계한다. operation 중복 방지·충돌·원자성 보장은 유지한다.
4. 컬럼 추가는 낙관적 표시, 삭제는 ACK 대기·삭제 검증 경로를 각각 계측해 체감 지연을 줄인다. 일반 자동저장 750ms 대기와 명시적 추가/삭제를 혼동하지 않는다.

- 계측용 web 타입 검사 및 profiling build 성공. 서버는 실제 HTTP/DB 경로와 ACK 내용 검증을 통과했다. 실험 코드만 lab에 커밋했으며 main에는 추가 반영하지 않았다.
- raw: artifacts/performance/2026-10-14-save-ack/{samples,summary,menu-50,ack-transition-50}.json. 초기 ack-replay/detail 파일은 startTransition 반영 전 자료로 최종 수치에서 제외한다.

[계획](../planning/2026-10-14-Performance-SaveAckMeasurement.md)
