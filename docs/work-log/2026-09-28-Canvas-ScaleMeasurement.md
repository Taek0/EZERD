# 대규모 fixture 조사와 실행 제한

작성일: 2026-09-28
제품 기준: `ee6e533`의 최적화된 관계 준비. 이번 단계는 제품 코드 변경 없이 측정 도구를 추가한다.

## 도구

- `pnpm perf:scale`은 50·100·300개(컬럼10개·관계1배)의 실제 `prepareTableRelations` 전체를 측정한다. 개수를 인수로 지정할 수도 있다.
- fixture 생성·진단은 측정 밖에서 실행하고, 첫 계산 시간을 별도 기록한다. 첫 계산1초 이하일 때 준비5회 후30회를 실행한다. 초과하면 `single-sample-budget` 상태로 중단하며 중앙값/p95를 만들지 않는다.
- 각 크기는 별도 Node 프로세스로 실행하고 시작부터30초 wall timeout을 둔다. 실패·timeout·출력 상한 초과는 별도 상태로 저장하며 0ms로 대체하지 않는다.
- 자식은 직접 실행하는 단일 Node 프로세스다. timeout 종료 시 출력 일부가 잘렸으면 원문과 파싱 실패 라인을 보존한다. 로그 상한은1MiB다.
- 결과는 `artifacts/performance/scale-<timestamp>/<count>.json`에 저장하며 Git 제외 대상이다. metadata에 코드 SHA·dirty·Node/OS/CPU, 제한 조건을 포함한다.
- `node --test scripts/performance/bounded.test.mjs`로 정상 종료·오류·실행 파일 없음·timeout·출력 제한·부분 JSON 보존을 검증한다.

## 사전 확인

미커밋 도구의 최초 확인에서 50개 first23ms, 100개 first96ms, 300개 first1641ms를 관찰했다. 이 결과는 도구 동작 확인용이며 최종 고정 커밋 결과는 아래에 기록한다.

사전 결정한 1초 한계를 넘은300개는 브라우저 실행과30회 반복을 보류한다. 100개까지만 브라우저의 EDIT/MOVE/PAN을 확인한다. 이는 300개를 지원할 수 없다는 결론이 아니라 현재 동기 계산의 긴 작업 위험을 근거로 한 조사 중단 조건이다.

## 사용

```powershell
node --test scripts/performance/bounded.test.mjs
pnpm perf:scale
pnpm perf:scale 100
```

Node 시간은 브라우저 표시 지연이나 전체 사용자 입력 지연이 아니다. fixture 하나의 전체 관계 준비 비용이며 layout/paint·전송·협업은 포함하지 않는다. 첫 계산이 반복보다 느리거나 빠를 수 있으므로 first와 warm 통계를 섞지 않는다.
