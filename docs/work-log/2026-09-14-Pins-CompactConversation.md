# 핀 대화 밀도 및 사이드바 전환

- 핀 본문 14px, 작성자 12px, 날짜 11px로 크기를 조정하고 공용 Avatar와 작성자·날짜·짧은 본문 구조를 사용했다. 날짜의 전체 시각은 title로 확인할 수 있다.
- 공용 Textarea를 아바타 옆 28px 한 줄 입력으로 배치했다. 포커스나 초안이 있으면 64px로 확장하며 멘션 및 등록 버튼을 표시한다. 밝은 프로젝트 테마를 유지했다.
- 핀 마커를 기존 커밋의 둥근 물방울 윤곽으로 복원하고 30px로 줄였다.
- 사이드바를 계속 마운트하면서 너비·투명도·이동 전환을 적용했다. 닫을 때 즉시 inert 처리하고 전환 뒤 visibility를 숨기며, reduced-motion은 전환을 제거한다.
- 활성 핀을 바꿀 때도 답글 Composer를 보존하여 초안이 유지된다. 패널을 닫고 다시 열어도 초안과 스레드가 유지된다.
- 알림 팝업의 너비와 폰트도 소폭 축소했다.

## 검증

- `pnpm --filter @ezerd/web typecheck` 통과.
- `scripts/browser-project-feedback-smoke.mjs`의 실제 로컬 앱 검증 통과. 일시적 첫 로딩 공백 재실행에서 pageerror는 없었다.
- 우클릭 위치 핀 작성, 전체 작성자 핀, 답글 등록, 답글 초안의 핀 전환 및 패널 닫기·다시 열기 유지 확인.
- 본문 14px, 입력 28px에서 64px 확장, 마커 모서리 4px, 닫기 시 inert 및 너비 0, 220ms 전환, reduced-motion의 전환 0s 확인.
- 1100/560/390px 화면에서 패널 가로 넘침 없음 확인. 390px 실제 스크린샷에서 간결한 아바타·본문·입력 배치 확인.
- 기존 갤러리 보관/삭제 확인창, 취소/확인, 포커스 복귀 검증도 통과. 검증용 프로젝트와 사용자 정리 완료.
- 화면: `.cache/verification/project-feedback-pins.png`, `.cache/verification/project-feedback-pins-mobile.png`.
