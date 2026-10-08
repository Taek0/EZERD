# 자동저장 회귀 테스트 갱신 계획

- 작성일: 2026-10-08
- 범위: 웹 NativeERDCanvas, condition hints, clipboard, clipboard interaction, canvas decoration, auxiliary component parity의 지정된 6개 테스트만 수정한다.
- 수동 제출 기대를 실제 callback·fake timer·재렌더 기반 자동저장 검증으로 전환한다.
- dirty/export blocker, 외부 busy fieldset, 권한, 보관, late clipboard read, ACK 보호 검증을 유지한다.
- useLayoutEffect를 mock driver에 지원하고 제품 소스 문제는 수정 대신 보고한다.
- 지정 테스트 및 수정 파일 포맷 검증 후 변경 파일 목록을 오너에게 전달한다. 공유 index 경합으로 직접 add/commit하지 않으며 단위 커밋은 오너가 처리한다.
