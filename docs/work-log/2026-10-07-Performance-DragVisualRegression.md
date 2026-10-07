# 저배율 손 도구 UI 깨짐 조사 기록

> 후속 정정: IAB clip 좌표가 캡처에 반영되지 않는 것이 확인됐다. 아래의 패널 위치 픽셀 불일치를 제품 페인팅 오류의 증거로 사용하지 않는다. [후속 감사 및 확인된 스크롤 문제](2026-10-07-Performance-LowZoomLayerAudit.md)를 우선 참조한다.


## 재현 조건과 관측

- 사용자 환경: Chrome 시크릿 모드 localhost:3001, 15% 이하로 축소한 뒤 손 도구로 이동. 첨부 화면에서 카드·관계선 표시가 불안정하다.
- 서비스 HTML의 asset 이름이 D:/ChatGPT/ERD/apps/web/dist/index.html과 일치한다. 서비스 checkout HEAD는 215732f이며 lab에도 해당 main을 병합했다.
- 50테이블×10컬럼의 쓰기 차단 fixture, Codex IAB, 2546×1283 viewport에서 11% 배율(실제 camera.zoom≈0.112157)과 손 도구 드래그를 비교했다.
- 캡처에서 관계선 소실 및 패널 위치에 캔버스 배경이 보이는 불일치를 관찰했다. DOM상 패널은 aria-hidden=false, opacity=1, visibility=visible이며 hit-test도 해당 패널을 반환했다. 에러 로그는 없었다.
- fixture의 전체 페이지 scrollY=225 등 문서 스크롤도 발생했다. 상단 UI가 화면 밖으로 나가는 부분은 이 스크롤과 구분해야 한다. 따라서 모든 상단 UI 소실을 paint 오류로 단정하지 않는다.
- 실제 Chrome 확장 연결로 교차 확인을 시작했으나 locator/실행 시간 초과가 발생했다. IAB 캡처 경로의 영향과 사용자 Chrome 증상이 동일 원인인지 아직 확정하지 않았다.

## 비교 결과

다음 비교는 문제가 사라진다는 증거를 얻지 못했다. 원인 확정이나 해결책으로 채택하지 않았다.

- 카드 content-visibility를 visible로 강제.
- world will-change:transform 승격 힌트 제거.
- 관계선 SVG의 1×1px viewport를 100×100px로 확대.
- 점 격자 배경 제거.
- 15% 이하에서 transform scale 대신 CSS zoom 사용.
- 0×0 world/scene 경계를 명시적 100% 크기로 변경.
- surface에 contain:paint 적용.

제품 tsx/css 후보는 모두 원복했다. 기본 main checkout·3001 서버·실제 문서는 변경하지 않았다. lab fixture에는 기본값 off인 네 가지 비교 토글만 남긴다.

## 상태 및 다음 확인

확인 완료나 수정 완료가 아닌 조사 중간 기록이다. 데이터/React DOM 삭제는 관찰하지 않았지만, 브라우저 합성 오류로 확정할 근거도 아직 부족하다. 실제 Chrome에서 같은 DOM 상태와 화면 픽셀을 확보하고, fixture의 문서 스크롤 및 캡처 영향부터 분리해야 한다. 사용자 문서의 무단 로그인·쓰기·설정 변경은 수행하지 않았다.

[계획](../planning/2026-10-07-Performance-DragVisualRegression.md)

검증: 제품 후보 원복 후 pnpm format / pnpm check 통과(232개 파일·2,818개 테스트, 27개 파일·506개 조건부 skip), 제품 및 성능 빌드 통과. 이 테스트 통과는 시각적 오류가 해결됐다는 뜻이 아니다. 신규 작업은 진단 fixture와 기록에 한정한다.
