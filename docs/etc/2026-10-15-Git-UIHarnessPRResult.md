# 최신 main 반영 및 테스트 정리 PR 준비 결과

- origin/main 13cba79를 performance-lab에 병합했다(0f9b8a8). 워크스페이스 순서 저장과 설계 모드 UI 변경을 포함한다.
- 충돌 2곳은 main의 useCallback 추가와 공통 driver 전환이 겹친 부분이다. 공통 driver가 callback memoization을 제공함을 확인해 통합했다.
- 병합 후 pnpm check 통과: 2,947 tests passed / 496 skipped, 포맷·타입·제품 빌드 성공.
- D:/ChatGPT/ERD-ui-harness-pr의 codex/ui-harness-cleanup을 최신 main에서 생성하고 테스트 정리 커밋 4개만 선별했다. lab 전용 계측 코드·설정·원시 결과는 PR에서 제외한다.
- 기본 checkout D:/ChatGPT/ERD의 main 및 기존 변경은 수정하지 않았다.
