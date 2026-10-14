# 서버 저장 지연 개선 결과

## 변경 내용

- 입력 스키마 파싱 결과를 비공개 Symbol 표식이 있는 서버 내부 envelope로 전달한다. sync service와 candidate preparation에서 중복되던 전체 파싱을 1회로 줄였다. raw/normalized fingerprint 검사는 원래 preparation 경계에 유지한다.
- 명령 경로에서 row lock 이후 같은 트랜잭션으로 발급·저장한 baseline만 메모리에서 재사용한다. 일반 protocol 요청이나 해당 baseline이 없으면 기존 DB 조회를 사용한다. user/client/project/revision/time/fingerprint 검사는 그대로 수행한다.
- 검증된 ACK에서 이벤트를 구성할 때 전체 ACK 문서를 다시 파싱하지 않고 추가 changes만 파싱한다. ACK 저장/조회/구형 클라이언트/경량 응답 형식은 유지한다.
- read/replay → row lock/replay → design 권한 → 명령/원본 검증 → write 순서는 변경하지 않았다. field versions, retired identity, 후보 DB 검증도 제거하지 않았다.

## 실제 HTTP 실측

43테이블/436컬럼 실제 문서 복제본, 별도 로컬 Nest 서버와 실제 PostgreSQL. 각 동작 4회 중 warmup 1회를 제외한 3회 중앙값. 변경 전후 각각 16회 저장 모두 승인됐고, compact ACK lookup replay와 전체 서버 문서의 일치가 확인됐다. 임시 사용자/워크스페이스/프로젝트는 finally에서 정리했다.

| 동작 | 이전 HTTP ms | 이후 HTTP ms | SQL 횟수 이전→이후 |
| --- | ---: | ---: | --- |
| 이름 변경 | 391.04 | 336.74 | 20→19 |
| 컬럼 추가 | 460.65 | 326.31 | 20→19 |
| 컬럼 삭제 | 466.21 | 379.37 | 21→20 |
| 10개 속성 변경 | 453.29 | 352.07 | 20→19 |

HTTP는 POST 저장 요청/응답 구간이며 선행 lookup·브라우저 IDB/렌더링 시간은 별도다. V8 CPU profiling을 켠 순차 비교로, 작은 표본·GC·DB 캐시 영향을 포함한다. 감소폭을 모든 환경에 일반화하지 않는다. 원시 profile에서 문서 크기 검사의 포괄 표본 시간은 요청당 평균 약 32.6→19.5ms였다. profiler 자체 비용/서로 포함되는 함수 시간을 합산하지 않는다.

## 검증

- 집중 unit 50개 통과. parsed/raw 경로 결과 동등성, archived/actor/field-conflict/없는 baseline, 파싱 이후 raw 변경 및 envelope 위조 거부 포함.
- 격리 DB integration 200개 통과: replay 접근 권한, 취소, 기능 경로, deferrable, client subscription/event, history.
- 테스트 DB와 벤치마크용 데이터 정리 완료. 사용자 원본은 수정하지 않았다.
- 원시 자료: lab artifacts/performance/2026-10-14-server-{before,after}-delta/ 및 server-save-{integration,events}.log.
- DB migration은 없다. 새 서버 빌드를 적용하려면 현재 실행 중인 서버를 재시작해야 한다.
