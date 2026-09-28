# 제품 성능 최적화 PR 분리 검증

작성일: 2026-09-28

- main 293ff60에서 별도 worktree와 codex/canvas-performance-only를 생성했다. 원본 feat/performance-measurement는 변경하지 않았다.
- 원본3e2e5f0의 제품8개 파일을 선별했고 내용이 동일함을 비교했다. 회귀 테스트와 테스트용 기준 알고리즘을 유지했다.
- 테스트 fixture를 src/test-utils/diagram-fixture.ts로 분리했다. collector·fingerprint·계측 화면·Vite 성능 설정·scripts/performance 의존성은 없다. package.json·lockfile·tsconfig·ignore 설정은 main과 동일하다.
- 새 checkout의 오프라인 캐시에 검증 metadata가 없어 정상 온라인 설치로 완료했다. 잠금 파일을 유지했고 공급망 정책 검사를 통과했다.
- 초기 전체 검사는 기본 .env가 없어 설정 테스트5개가 실패했다. pnpm setup으로 추적 중인 예제 환경을 생성한 뒤 재검증했다. 실제 DB 서비스·마이그레이션은 실행하지 않았다.
- pnpm format 및 pnpm check 통과:386개 테스트 통과, DB 관련25개 skip, 전체 타입·포맷·빌드 통과. 큰 청크 경고는 기존처럼 남는다.
- 프레임 병합의 최종값/상태 반영 횟수는 검증됐지만 paced drag 체감 속도 개선 판정은 보류다. 전체 UI lifecycle·권한 전환 수동 검증은 완료한 것으로 표시하지 않는다.
- 제품 코드8개+회귀 검증 파일8개+계획/검증 문서2개로 PR을 구성한다. 원격 별도 브랜치로 게시하고 main 대상으로 리뷰를 요청하되 main 직접 push/병합은 하지 않는다.
