# 캔버스 피드백 구현 및 검증

- 도메인 카드 제목 28px, 설명 16px, 보조 글자 13px로 조정하고 도메인 열기 버튼을 카드 하단에 배치했다. 도메인 맵에서 중복 복귀 버튼을 제거하고 내부 뷰 복귀 버튼 정렬을 수정했다.
- 도메인 함께 보기의 이름·다중 선택·저장·열기·삭제 UI를 추가했다. 모델의 영속 views API와 독립 배치를 사용하며, 원본 테이블 ID와 소유 도메인을 유지한다. 렌더링에서도 선택 도메인 소유 테이블 및 양쪽 끝점이 모두 존재하는 관계만 필터링한다. 함께 보기에서 외부 도메인 참조 추가·원본 소유 도메인 없는 새 테이블 생성을 노출하지 않는다.
- 테이블 렌더링·크기 조절·자동 배치를 shared tableCardSize와 일치시켰다. 새 함께 보기의 첫 자동 배치도 실제 카드 크기를 사용한다.
- 도메인과 빈 캔버스 메뉴, 테이블의 메뉴 콜백으로 우클릭 위치에 빈 공간 핀을 생성한다. 메뉴가 화면 가장자리에서 이동하더라도 실제 포인터 좌표를 유지한다.
- PK 관계 연결 동안 마우스를 따라오는 직각 점선을 표시하고 Escape로 취소한다.
- Canvas의 삭제 확인을 ConfirmProvider로 교체했다. 네이티브 details의 details-content 높이·투명도 전환으로 사이드바 토글을 애니메이션 처리하고 summary 텍스트 선택을 막았다. 감소된 모션 설정에서는 전환을 끈다.
- 2배 PNG 내보내기는 현재 확대·이동에 독립적인 전체 카드 및 관계선/라벨 경계를 사용한다. 실제 computed style과 사용된 글꼴의 unicode subset을 SVG에 포함한 후 PNG로 변환한다. 툴바, 카드 조작 버튼, 리사이즈 핸들, 연결 조절 버튼, 핀 및 임시 연결선은 제외한다. 별도 패키지 의존성은 추가하지 않았다.
- 색상 선택은 무료 React Aria의 ColorPicker / ColorArea / ColorSlider / ColorSwatch와 기존 UntitledPopover 및 Button을 조합했다. HEX 입력과 추천 색상 팔레트를 제공한다. 공개 Untitled UI Color Picker 페이지의 코드 링크는 유료 구매로 이어지므로 해당 유료 소스를 사용하거나 공개 MIT 소스를 사용했다고 표시하지 않았다. 참고: https://react-aria.adobe.com/ColorPicker, https://www.untitledui.com/react/components/color-pickers.

## 검증

- `pnpm --filter @ezerd/web typecheck`: 통과.
- `pnpm exec vitest run apps/web/src/Canvas.test.ts`: 4개 통과.
- `scripts/browser-canvas-feedback-smoke.mjs`: 실제 Chrome에서 함께 보기 소유권 및 선택 관계 필터, 빈 공간 핀 좌표, 테이블 우클릭의 함께 보기 핀 viewId, 색상 팝오버, 테이블 내부 가로·세로 넘침 없음, PK 직각 점선·Escape, PNG 다운로드를 검증했다.
- 생성된 `.cache/canvas-feedback-export.png`는 2376×944 PNG다. 이미지 파일을 열어 한글·컬럼·PK/FK 하이라이트·직각 관계선·`orders.id:payments` 라벨이 보이고 조작 핸들이 없는 것을 확인했다. 첫 시각 검증에서 카드 밖 관계 라벨 잘림을 발견하여 SVG getBBox를 export 경계에 포함시킨 후 재검증했다.
- 별도 검증용 HTML은 스크립트 종료 시 제거된다. 127.0.0.1:5173 개발 서버만 사용했다.
