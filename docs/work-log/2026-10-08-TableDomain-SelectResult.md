# 테이블 소속 도메인 Select 구현 결과

- 기본 정보에 소속 도메인 Select를 배치하고 기존 안내·이동 버튼을 제거했다.
- 일반 속성과 동일한 inspector-fields 스타일을 재사용하여 label을 14px로 맞췄다. 공유 CSS 변경은 없다.
- 선택 즉시 moveNativeTableDomain으로 검증하고 move_table_domain 명령을 기존 save에 버전·시퀀스·DB revision과 함께 전달한다.
- 미소속 선택, 조회 전용 차단, 동일 값 무시, 저장 중 중복 요청 차단을 지원한다. 저장 확인 전과 실패 시 현재 문서의 도메인을 유지하고 저장된 문서가 갱신되면 해당 값을 표시한다.
- 다른 뷰로 전환하지 않는다. NativeDomainEditor 및 다른 워커 담당 파일은 수정하지 않았다.
- 전용 테스트 7건과 기존 NativeProjectView 관련 테스트 8건, 총 15건 통과. 웹 TypeScript 검사 통과.
- 전체 포맷 대신 변경 TSX·테스트에만 설치된 Prettier를 실행했다. 최초 pnpm 실행은 샌드박스 realpath EPERM으로 실패하여 설치된 Node 도구를 승인된 실행 경로로 직접 호출했다.
- 브라우저 QA는 임시 DB와 연결된 127.0.0.1:5174에서 후속 수행한다.

계획: [소속 도메인 Select 계획](../planning/2026-10-08-TableDomain-SelectPlan.md)
