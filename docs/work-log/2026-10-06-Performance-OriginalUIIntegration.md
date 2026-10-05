# 원본 UI 통합과 회귀 검증

- 도메인/테이블 카드 크기 조절 손잡이를 복원했다. Native 배치 draft에 크기를 보관하고 기존 저장 경로를 사용한다. 드래그와 방향키 조작, Enter 저장을 지원하며 권한·pending 가드를 유지한다.
- 히스토리는 원본 공통 팝오버를 사용한다. 기존 Native 이력 내용과 재시도/취소 경로는 유지한다.
- 공통 Select의 disabledKeys 및 선택 callback 검증을 명시했다. 기존 Native 정책 테스트는 숨겨진 HTML select의 SSR 모양 대신 전달되는 옵션 정책을 검사한다.
- 브라우저 실측에서 inspector grid 220ms / opacity 180ms, 컬럼 WAAPI 180ms, domain-enter 240ms, 댓글 width 220ms / opacity 180ms, 팝오버 ui-overlay-in 150ms를 확인했다.
- 통합 중 전체 검사에서 206개 파일·2,598개 테스트가 통과했고 497개 환경 조건부 테스트는 건너뛰었다. 이후 크기 조절/히스토리 통합의 최종 검사와 이동 측정은 최종 검증 문서에서 기록한다.
- 실제 사용자의 프로젝트/댓글을 수정하지 않았다. 별도 4177 예제는 synthetic actor와 로컬 GET 응답만 사용하며 API 쓰기는 차단한다. 해당 예제/계측 코드는 제품 PR에 포함하지 않는다.
