# 실제 문서 경량 ACK·편집·패널 검증

## 대상과 보존

- klassboard-backend: 원본 version 281, sequence 290, 43 tables / 436 columns / 66 원본 관계(물리 화면 표시 61).
- localhost:3001 실제 재시작 서버와 최신 클라이언트 `index-CN20ue87.js` 확인.
- 실제 원본은 조회만 했다. 서버 편집은 같은 문서를 복사한 임시 프로젝트, 브라우저 편집은 서버 쓰기가 차단된 복제 fixture에서 수행했다.
- 임시 프로젝트·워크스페이스·계정은 finally에서 정리했다. 원본 fingerprint 및 sequence가 동일함을 재확인했다.
- 실제 사용자 탭에서는 우측 패널을 397→517→397px로 조절하고 복원했다.

## 실제 서버

4종 동작×4회(각 1회 warmup), 총 16회 승인. 요청 헤더 delta-v1에 대해 document 없이 delta가 수신되는지 강제 확인했다. 결과 lookup replay와 전체 document-state의 sourceDocument가 모두 일치했다.

| 동작 | ACK bytes 중앙값 | HTTP ms 중앙값 | 클라이언트 schema ms | Node ACK 적용 ms |
| --- | ---: | ---: | ---: | ---: |
| 이름 변경 | 733 | 455.17 | 0.13 | 22.90 |
| 컬럼 추가 | 1223 | 422.08 | 0.13 | 22.08 |
| 컬럼 삭제 | 1398 | 428.14 | 0.13 | 23.11 |
| 10개 속성 변경 | 2425 | 450.80 | 0.10 | 22.42 |

현재 서버 프로세스 외부에서 측정했으므로 내부 SQL/서비스 함수 시간은 수집하지 않았다. 초기 원시 레코드의 sqlMs/sqlCount=0은 미계측을 뜻하며 실제 SQL 0회를 뜻하지 않는다. 이후 계측기는 외부 서버일 때 null로 명시한다.

## 브라우저 로컬 표시

실제 데이터 복제본, profiling build, DOM polling 기준 단일 실행이다. 실제 paint/INP 측정은 아니다.

- 이름 입력→로컬 DOM 확인: 325.3ms. 서버 전송 시작 1528.8ms보다 먼저 반영.
- NULL 속성 큐 등록→표시: 245.2ms.
- 삭제 큐 등록→행 제거: 212.7ms.
- 지연된 이전 ACK 이후 최신 입력 보존, 컬럼 추가 중복 없음, 삭제 유지, 마지막 저장 큐 비움 모두 true.
- 이 자료는 서버 대기 분리가 동작함을 보여주지만 로컬 반영의 200~325ms 비용은 여전히 개선 대상이다.
- 실제 문서는 카드 순서가 원본 배열과 다르고 comment 열을 숨긴 카드가 있어 초기 계측이 실패했다. DOM의 실제 편집 행 ID 및 표시되는 NULL 필드로 판정 기준을 수정한 성공 실행만 사용했다.

## 우측 패널

첫 계측 4회 모두 targetReached/documentUnchanged=true. warmup 제외 React 합산 31.6~36.8ms, 프레임 p95 20.1/20.1/90ms, 최장 간격 최대 1010ms였다. 긴 정지를 React 렌더링만의 문제로 단정할 수 없다. 탭 visibility/focus 및 Long Animation Frame을 추가 수집해 별도 판정한다.

원시 자료는 lab `artifacts/performance/2026-10-14-actual-document/`와 `2026-10-14-actual-server-delta/`에만 보관한다. 원본 snapshot은 Git ignore 대상이다.

## 전경 재검증과 판정

사용자가 측정 탭을 전경에 둔 뒤 별도로 4회 재실행했다. 워밍업 제외 3회는 모두 visible:focused, targetReached=true, documentUnchanged=true였다.

- 프레임 간격 median: 10ms, p95: 20.1 / 20.1 / 20.0ms, max: 40.1 / 30.1 / 40.1ms.
- React 합산: 30.8 / 45.7 / 38.4ms. 각 왕복 전체의 합산이며 프레임당 비용이 아니다.
- Long Animation Frame 관찰 항목: 0개. 재측정에서는 1초 정지 미재현.
- 전경 전환 이전 진단에서는 약 1초 간격을 반복 관찰했지만 해당 long frame의 대부분은 renderStart 이전 대기였고 blockingDuration=0, scripts=[]였다. document visibility/focus 값만으로 OS 가림이나 브라우저 스케줄링을 배제할 수 없으며 이를 제품 React의 1초 실행으로 해석하지 않는다. 전경 재실행 수치를 최종 비교 기준으로 삼는다.

추가 compact ACK replay의 워밍업 제외 파싱 중앙값은 약 0.1ms, 문서 적용 18.6ms, React 합산 68.4ms였다. 이 보조 계측의 `reflected` 필드는 실제 화면 순서와 다른 첫 카드만 검사하는 기존 판정식 때문에 false였다. 타이밍은 참고값으로만 보존하며 시각 반영 성공 근거로 사용하지 않는다. 후속 계측기는 대기 조건과 완료 조건 모두 동일한 전체 카드 검색을 사용하도록 수정했다. 실제 ACK 상태 일치는 앞의 서버 16회 및 이름/NULL/삭제 지연 ACK 브라우저 성공 시나리오로 검증했다.

## 다음 개선 우선순위

1. 로컬 변경→DOM의 200~325ms 구간을 React commit/문서 projection/레이아웃으로 분해한다. 서버 대기 분리를 되돌릴 이유는 없다.
2. ACK 적용 시 전체 문서 복사·정규화·검증 및 전체 뷰 렌더링 범위를 줄인다. 이번 보조 계측에서는 파싱보다 적용/렌더링 쪽 비용이 크다.
3. 패널은 동일 전경 조건으로 비교하며, 현재 20ms p95를 더 낮추려면 resize 중 CSS 레이아웃/paint를 별도 추적한다.

계측 도구 build 및 웹 typecheck 통과. 이 작업은 performance-lab의 계측·문서 변경이며 제품 main 코드 변경이나 새 push는 하지 않았다. 사용자가 요청한 탭 사용 종료를 알리고 복제 탭을 닫았다. 실제 사용자 탭은 유지했다.
