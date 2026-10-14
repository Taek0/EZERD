# 로컬 렌더 비용 개선 main 반영 결과

- 제품 커밋 12503a3: PK preview 재사용, 최신 문서/콜백/sequence 및 busy 회귀 테스트, 계획/실측 기록 반영.
- main `pnpm check` 통과: 2,927 passed / 499 skipped, format/type/build 정상.
- lab 전체 검사도 2,937 passed / 499 skipped. 단계별 계측 도구와 원시 자료는 performance-lab에 유지했다.
- 이름/NULL 로컬 변경 중 PK 계획 재검사는 0회로 감소. 후보 3회 DOM 반영 중앙값은 이름 185.7ms, NULL 131.2ms. 삭제 성능 개선은 확인하지 못했다.
- 실행 서버 수정은 없으며 새 클라이언트 빌드가 생성되었다. 브라우저 새로고침으로 확인할 수 있다.
- 원격 push는 수행하지 않았다. 기존 사용자 변경과 docs/EZERD.txt는 수정하지 않았다.
