# 테이블 자동 배치 통합 검증

[계획](../planning/2026-10-21-Canvas-TableAutoLayoutPlan.md)에 따라 origin/main 880f9bc를 performance-lab에 반영하고 테이블 전용 배치 모델과 Worker UI를 구현했다. 기존 도메인 배치·일반 테이블 이동·관계선 자동 정리 실행 조건은 유지한다.

- 모델: [계층·그룹·다중 행 배치와 합성 측정](2026-10-21-Canvas-TableAutoLayoutModelResult.md), 커밋 fa0a51d.
- UI: [Worker·취소·결과 검증·일괄 저장](2026-10-21-Canvas-TableAutoLayoutUIResult.md), 커밋 2260763.
- 구현자 외 모델 에이전트가 UI의 오래된 결과 폐기, 취소/수명, 관계 방향·표시 범위, 단일 batch 저장 경로를 읽기 전용으로 검토했다. 추가 결함은 발견하지 못했다.

## 복제 도면 비교

기존에 보관한 문서를 복제 입력으로 사용했으며 원본 프로젝트나 실행 서버에는 쓰지 않았다. 테이블 표시 크기를 사용해 기존 모델 배치와 새 모델 배치를 비교했다. 메모 아래 이동은 UI 어댑터 단계이므로 아래 순수 모델 경계에 포함하지 않았다.

| 복제 입력 | 이전 경계(폭×높이) | 새 경계(폭×높이) | 겹침 | 반복 실행 |
| --- | --- | --- | --- | --- |
| 물리 43테이블·61관계 | 7,620×18,921 | 8,445×11,142 | 0 | 좌표 동일 |
| HWP 논리 49테이블·75관계 | 8,200×3,756 | 9,260×7,720 | 0 | 좌표 동일 |

세 번 예열 후 아홉 번 순수 계산 중앙값은 각각 약 0.40ms/0.18ms다. Worker 기동·데이터 전달·렌더링·관계선 재라우팅·서버 저장은 포함하지 않는다. 200 간격과 부모 위/자식 아래 제약 때문에 기존 배치보다 면적이 늘어나는 문서도 있다. 긴 단일 연결을 접는 기능은 이번에 추가하지 않았다.

원시 자료: artifacts/performance/2026-10-21-table-layout/compare.mjs, actual-results.json 및 두 도면의 before/after JSON. Git 제외 대상이다.

## 반영 범위

격리 워크트리 codex/performance-lab에서 작업했다. main checkout, 실제 문서, 실행 서버와 DB schema는 변경하지 않았다. 원격 push/PR 생성은 이번 요청에서 수행하지 않았다.

## 전체 검사

- pnpm format 적용 후 pnpm check 최종 통과: 276개 파일, 3,089개 테스트 통과 / 환경 조건부 500개 건너뜀. 전체 타입 검사·서버/웹 빌드 성공.
- 최초 기존 font-cache 검사만 5초 timeout이 발생했고 소스·시간 제한·skip 설정 변경 없이 동일 전체 명령 재실행으로 통과했다. 두 로그 모두 보존했다.
- 제품 빌드에 native-table-auto-layout.worker-CiWpuVGj.js(16.33kB)가 별도 산출됨을 확인했다. 기존 큰 main chunk 경고는 남아 있다.
- 구성용 더미 로컬 DATABASE_URL을 사용했다. 실제 DB 동시성 검사는 활성화하지 않았으며 실제 브라우저의 FPS·최종 Worker 왕복 지연을 실측하지 않았다.
- 전체 로그: artifacts/performance/2026-10-21-table-layout/format.log, check.log, check-retry.log.
