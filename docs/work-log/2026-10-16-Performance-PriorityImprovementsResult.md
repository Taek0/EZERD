# 우선 성능 개선 통합 결과

[계획](../planning/2026-10-16-Performance-PriorityImprovements.md)에 따라 원격 main f318b8e를 격리된 codex/performance-lab에 병합하고 구현했다. 병합 충돌은 제품용 테스트 fixture 교체와 기존 결과 문서의 main 검증 기록을 유지하여 해결했다.

## 완료 단위

- [캔버스](2026-10-16-Performance-CanvasResult.md): 그룹 이동의 중복 장면 계산 제거, 콘텐츠 인덱스 및 치수 공유. 레이아웃 변경 시 관계선 장애물 재계산은 유지한다.
- [DB 검증](2026-10-16-Performance-ValidationResult.md): 테이블별 컬럼·이름·키 인덱스. 기존/신규 오류 구분과 진단 순서 보존.
- [댓글](2026-10-16-Performance-ReviewResult.md): N개 핀의 데이터 조회 2N+1개를 2개로 변경. 생성 외 프로젝트 잠금은 상태만 조회한다.
- [세션](2026-10-16-Performance-SessionResult.md): 마지막 활동 갱신을 1분 간격 조건부 쓰기로 변경. 인증·만료·폐기 확인은 매 요청 유지한다.

## 범위와 후속

미사용 코드·의존성 정리는 보류했다. 일반 드래그 라우팅 예산, 갤러리·댓글 API 페이지화, 실시간 권한 조회 중복, 저장 경로의 버전·tombstone 작업은 별도 후속 후보다. 이번 변경으로 실제 브라우저 FPS 또는 저장 전체 지연이 특정 비율만큼 개선됐다고 주장하지 않는다.

로컬 main, 사용자의 실제 문서, 실행 서버와 DB 스키마는 변경하지 않았다. 이번 요청에서는 원격 push나 PR 생성을 수행하지 않는다.

## 갤러리 완료

[갤러리 결과](2026-10-16-Performance-GalleryResult.md): 매번 현재 멤버십과 프로젝트 head를 확인하고 동일 head의 미리보기만 재사용한다. 초기/변경 문서는 같은 snapshot에서 16개씩 읽고 캐시는 미리보기만 256개·직렬화 크기 1MiB로 제한한다. SQL 투영은 큰 합성 문서에서 느려져 제외했다. 첫 조회 비용과 페이지가 없는 REST의 한계는 남는다.

## 교차 검토

캔버스 캐시 의존성과 그룹/resize 경로, 갤러리 권한·snapshot·캐시 무효화는 구현자 외 6.1 Sol 에이전트가 읽기 전용으로 검토했으며 추가 정확성 문제는 발견하지 못했다. 원본 문서 mutation 대신 복제·합성 입력과 테스트를 사용했다.

## 통합 검증

- `pnpm.cmd format` 및 `pnpm.cmd check` 최종 통과: 274개 테스트 파일, 3,064개 테스트 통과, 환경 조건부 500개 건너뜀. 포맷·전체 타입 검사·서버/웹 제품 빌드 성공.
- 최초 실행에서 기존 font-cache 해시 검사만 5초 timeout이 발생했다. 코드·timeout·skip 설정 변경 없이 같은 전체 명령을 재실행하여 통과했다. 두 실행 로그를 보존했다.
- 구성 검사용 더미 로컬 DATABASE_URL을 사용했다. 최종 제품 변경의 실제 DB 동시성/운영 지연과 브라우저 FPS는 이번 통합 검사에서 측정하지 않았다. 갤러리의 제외된 SQL 실험만 별도 임시 PostgreSQL에서 수행했다.
- Vite의 기존 큰 chunk 경고는 남아 있으며 번들 분할은 이번 범위에 포함하지 않았다.
- 로그: `artifacts/performance/2026-10-16-priority-format.log`, `2026-10-16-priority-check.log`, `2026-10-16-priority-check-retry.log` (Git 제외).
- 구현 커밋: 세션 `9bfccaf`, 댓글 `400f04e`, DB 검증 `16ca829`, 캔버스 `56bd63e`, 갤러리 `b9b0b1a`.
