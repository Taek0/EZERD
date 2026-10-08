# Native world 상시 레이어 승격 힌트 제거

## 원인 분리 근거

실제 Chrome localhost:3001에서 사용자가 buttons=0 커서 이동으로 재현했다. 전후 camera·viewport·surface scroll, 50개 카드의 style/rect/row count, SVG 관계선 path 118개, panel/surface rect가 동일했지만 전체 캡처에 가로 띠 형태의 표시 손상이 나타났다. 카메라 이동이나 DOM 카드 삭제로 설명되지 않는 관측이다.

같은 문서의 API 쓰기 차단 복제 화면에서 사용자가 수동 비교했다.

1. 카드 content-visibility 강제 visible: 여전히 발생.
2. 새로고침 후 world의 will-change:transform만 auto로 변경: 10% 손 도구 hover에서 발생하지 않음.
3. 해당 토글을 해제해 will-change:transform 복구: 다시 발생.

이 A/B/A 결과는 상시 world 레이어 승격 힌트와 증상의 연관성을 뒷받침한다. Chrome 내부 래스터/합성 단계나 드라이버 결함까지 확정한 것은 아니다. will-change:auto는 GPU 전체를 비활성화하는 설정이 아니다.

## 제품 변경

NativeERDCanvas의 world에 배율과 관계없이 willChange:'auto'를 지정해 공통 canvas-world의 will-change:transform을 덮어쓴다. 카메라 좌표식, 확대 제한, 카드/관계선 DOM, 편집 동작 및 애니메이션은 변경하지 않는다. Legacy canvas와 다른 UI의 will-change는 변경하지 않는다.

처음에는 15% 이하에서만 힌트를 해제했으나, 사용자가 20% 이상으로 확대했다 축소하면 재발한다고 확인했다. 모든 배율에서 해제하는 수동 비교는 정상이라, 확대 과정에서 힌트를 재적용하지 않는 방식으로 수정했다.

## 검증

- 실제 컴포넌트 회귀 테스트 5개 추가: 10/15/16/100% 배율과 저배율 패닝·확대 왕복에서 auto 유지 확인.
- pnpm format / pnpm check 통과: 234개 파일·2,841개 테스트, 27개 파일·506개 환경 조건부 skip. 타입·서버/웹 빌드 및 성능 fixture 빌드 통과. 기존 bundle 경고 유지.
- 복제 서버에 모든 배율 자동 적용 수정본을 빌드했다. 사용자가 새로고침하고 진단 토글을 모두 끈 상태에서 확대·축소 왕복 및 10% 손 도구 hover를 확인했고, 정상이며 재발하지 않는다고 확인했다. 이는 사용자 수동 검증 결과다.
- 상시 힌트 제거의 일반 배율 프레임 시간 비교는 아직 수행하지 않았다. 브라우저의 자동 합성 판단은 유지된다.
- 원본 문서는 조회만 했고 실제 localhost:3001/main은 수정하지 않았다. raw snapshot은 Git 제외 artifacts에만 남기며 생성 번들/public에 포함하지 않는다.

[실제 Chrome 관측·복제 환경](2026-10-07-Performance-ActualChromeFixture.md) · [계획](../planning/2026-10-07-Performance-ChromeHoverAudit.md)

## 제품 PR 독립 검증

최신 origin/main 63a0d72 기반 codex/native-world-promotion-fix에 제품 수정·회귀 테스트 5개 및 관련 문서만 선별했다. pnpm format / pnpm check 통과: 230개 파일·2,832개 테스트, 27개 파일·506개 조건부 skip, 타입·서버/웹 빌드 통과. 기존 bundle 경고 유지. 개인 뷰 배너 등 main 변경은 유지했으며 실제 문서 스냅샷·진단 서버/fixture는 제외했다.
