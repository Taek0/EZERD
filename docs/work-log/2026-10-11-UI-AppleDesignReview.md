# Apple Design UI 검토 결과

## 검토 범위와 기준

- 날짜: 2026-10-11 (Asia/Seoul)
- 브랜치: `codex/apple-ui-review`
- 기준 커밋: `d5e46e1`
- 워크트리: `C:\Users\TY\.codex\worktrees\apple-ui-review\EZERD`
- 적용 스킬: `D:\Code\EZERD\.agents\skills\apple-design\SKILL.md`. 원본의 미커밋 스킬을 읽어 적용했으며 워크트리에 복사하거나 수정하지 않았다.
- [계획](../../docs/planning/2026-10-11-UI-AppleDesignReviewPlan.md)
- UI 구현은 변경하지 않았다. 확인된 문제 두 건은 P2(일반 우선순위 개선)로 분류했다.

## P2: 갤러리 보조 텍스트의 대비를 높여야 한다

실제 ProjectGallery 컴포넌트를 활성 상태의 테스트 프로젝트 한 개로 렌더링하고, 브라우저의 계산된 전경·배경색으로 상대 휘도 대비를 계산했다. 상태·테이블 개수·수정 날짜·검색 안내·보관함은 사용 가능한 UI의 정보이며 비활성 컨트롤이 아니다.

| 대상 | 전경 / 배경 | 글자 크기 | 측정 대비 |
| --- | --- | --- | --- |
| 테이블·관계 개수 | `#7b8896` / `#f0f3f6` | 14px | 3.249:1 |
| 수정 날짜 | `#7b8997` / `#f0f3f6` | 13px | 3.214:1 |
| 검색 placeholder | `#8b98a5` / `#e2e7ed` | 14px | 2.368:1 |
| 선택되지 않은 보관함 탭 | `#84909d` / `#e9ecef` | 14px | 2.743:1 |

- 근거: [project-gallery.css](../../apps/web/src/features/projects/project-gallery.css), 53–61, 103–105, 205–217행. 카드 배경은 147–152행.
- 영향: 프로젝트 상태와 검색 진입점을 구별하기 어렵고, 작은 보조 텍스트의 가독성이 떨어진다.
- 스킬 기준: 접근성, 타이포그래피, 명확한 정보 위계.
- 개선: 보조 텍스트 색상 토큰을 더 어둡게 조정하고, 위계는 크기·굵기·간격으로 유지한다. placeholder와 선택되지 않은 탭도 함께 검증한다.
- 완료 조건: 활성 상태에서 해당 일반 크기 텍스트의 대비가 최소 4.5:1을 만족한다. 기준은 [W3C WCAG 2.2 SC 1.4.3 해설](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)이며, placeholder도 적용 대상이다.

## P2: 알림 패널의 닫힘을 재열기 입력으로 취소할 수 없다

- 근거: [CommentsPanel.tsx](../../apps/web/src/features/comments/CommentsPanel.tsx) 657–659행, [use-panel-dismiss.ts](../../apps/web/src/shared/hooks/use-panel-dismiss.ts) 7–12, 31–37행, [collaboration-panels.css](../../apps/web/src/styles/collaboration-panels.css) 45–49행.
- 재현: 일반 모션 설정에서 알림을 열고 → 250ms 후 닫기 클릭 → 50ms 후 다시 클릭한다. 닫기 후 160ms가 지나면 마지막 입력과 달리 패널이 닫힌다.
- 검증: 실제 Notifications 컴포넌트에 빈 알림 목록을 제공한 격리 화면에서 재현했다. 열기/닫기 클릭은 실제 trigger에 전달하고 마지막 DOM의 패널 존재 여부를 확인했다. 결과: `열기 → 닫기 → 50ms 뒤 재열기: 닫힘`.
- 원인: 닫힘 애니메이션 중에도 `opened`가 true이므로 다시 클릭하면 `close()`만 호출한다. 훅에는 `closing`을 취소하는 API가 없고 기존 닫기 타이머가 계속 동작한다. `closing`은 enabled가 false가 된 뒤에야 초기화된다.
- 영향: 빠른 재입력이 무시되고 사용자는 닫힘이 끝난 뒤 다시 눌러야 한다.
- 스킬 기준: 전환 중 입력 허용, 즉시 반응, 현재 시각 상태에서 전환 방향을 바꾸는 동작.
- 개선: open/closing 상태를 함께 관리하고 재열기 시 닫기 타이머를 취소한다. 시각 전환도 현재 opacity/transform에서 역전하도록 구성한다. 단순 팝오버에 스프링 라이브러리를 반드시 추가할 필요는 없다.
- 완료 조건: 닫기 50ms 후 재열기 시 열린 상태 유지, 일반 외부 클릭·Escape 닫기 정상 동작, reduced-motion에서도 동일한 최종 상태 보장.

## 유지할 구현과 디자인 방향

- 공통 버튼은 `:active`와 `data-pressed` 상태, focus-visible 표시를 제공한다. 근거: `components/ui/untitled.css` 719행 이후.
- AnimatedDetails는 현재 화면 높이를 읽고 기존 애니메이션을 취소한 뒤 새 목표로 전환하며 reduced-motion을 확인한다.
- 캔버스는 포인터 캡처, 잡은 위치와 배율을 고려한 상대 이동, 방향키 이동, 포인터 취소 처리를 제공한다. 근거: `NativeERDCanvas.tsx`, `NativeCanvasScene.tsx`.
- 주요 스타일에는 reduced-motion 분기가 존재한다. 이번 검토에서 이를 전부 동적 검증한 것은 아니다.
- 갤러리는 실제 격리 화면에서 1440px 폭의 3열, 390px 폭의 1열 배치를 확인했다. 문서 scrollWidth는 각각 1425px, 375px로 viewport를 초과하지 않았다.
- ERD는 정확한 위치 조작이 중요한 도구이므로 테이블 드래그에 관성·바운스를 일괄 추가하지 않는다. 반투명 소재와 애니메이션 추가보다 가독성과 재입력 대응을 먼저 개선한다.

## 검증과 제한

- `pnpm build:shared`: 성공.
- 기존 테스트 4개 파일, 73개 테스트 통과:
  - `NativeERDCanvas.interaction.test.ts`
  - `NativeCanvasScene.test.ts`
  - `ProjectGallery.test.ts`
  - `components/ui/ui.test.ts`
- `pnpm format:check`: 통과. 새 문서는 `.prettierignore`의 문서 제외 규칙을 따른다.
- `git diff --check`: 통과.
- 최초 오프라인 설치는 캐시 메타데이터 부족으로 실패했으며 이후 `pnpm install --frozen-lockfile`로 설치를 완료했다.
- 브라우저 검증은 `apps/web/.cache/ui-review/`의 임시 화면에서 실제 ProjectGallery·Notifications 컴포넌트를 사용했다. 모든 fetch를 빈 목록 응답으로 대체해 제품 서버에 요청하지 않았다. 이 화면은 Git 제외 대상이며 검토 커밋에는 포함하지 않는다.
- 스크린샷: `C:\Users\TY\.codex\visualizations\2026\10\10\01a12667-c321-7f80-be51-c759af309fa6\apple-ui-review.png` (로컬 검토 증거, 저장소 외부).
- 인증된 전체 앱, 실제 공동 편집·DB 저장, 실제 터치 기기, 스크린리더, OS 접근성 설정 변경은 검증하지 않았다. 캔버스는 코드와 기존 이벤트 핸들러 테스트 중심으로 검토했으므로 화면 성능이나 터치 품질이 검증됐다고 해석하면 안 된다.
- 멀티터치 중 포인터 교체와 큰 기본 글꼴에서 고정 px 레이아웃의 동작은 후속 기기 검증 대상으로 남긴다. 확인된 결함으로 집계하지 않았다.

## 후속 작업 순서

1. 갤러리 보조 텍스트 대비 보정과 계산된 스타일 재검증.
2. 알림 패널 재열기 시 닫힘 취소 구현과 빠른 연속 입력 회귀 검증.
3. 실제 프로젝트를 사용한 캔버스 터치·키보드·글꼴 확대 검증.
