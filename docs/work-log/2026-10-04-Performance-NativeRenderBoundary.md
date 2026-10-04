# Native 카메라와 문서 렌더 경계 분리 결과

2026-10-04. [계획](../planning/2026-10-04-Performance-NativeRenderBoundary.md)에 따라 eb16762 이후 NativeCanvasScene을 추출했다.

## 구현

- 카드·컬럼·테이블/도메인 관계선 JSX를 NativeCanvasScene으로 이동했다. React.memo의 기본 props 비교만 사용한다.
- camera transform과 툴바는 부모에 유지하며 카메라 상태를 scene props로 전달하지 않는다. 문서/장면/표시모드/선택/draft 대상이 바뀌면 정상 렌더링한다. 언어 변경은 scene 자체의 useI18n 구독으로 반영한다.
- 드래그·저장 동작과 zoom은 useLayoutEffect로 commit 이후 갱신하는 ref를 통해 이벤트 발생 시 읽는다. 렌더 중 최신 콜백 ref를 덮어쓰거나 custom comparator로 콜백을 무시하지 않는다. 실제 begin/preserve/savePlacement의 기존 권한·stale·busy 검사는 유지한다.
- 기존 CSS/DOM 구조와 텍스트, SVG 경로·카드 표시를 유지했다. 새로운 DOM wrapper는 추가하지 않았다.

## 검증

- 타입 검사, pnpm format/format:check, perf:build 및 일반 웹 production build 통과. 기존 번들 크기 경고는 남아 있다.
- NativeCanvasScene/NativeERDCanvas/스타일·개인 캔버스·shared/private PNG 등 6파일 85테스트 통과.
- 추가 회귀: 동일 event handler가 갱신된 actions와 zoom을 사용하는지, 이전 저장 콜백을 호출하지 않는지, 문서 이름/선택 props 갱신, Enter의 초안 저장/테이블 선택 분기.
- 50테이블·500컬럼 브라우저 실제 pan 및 Ctrl+wheel zoom에서 nativeCanvasScene, relationGeometry, nativeColumnTypeDisplay 모두 0회. 앞 단계에 남았던 nativeColumnTypeDisplay 500회가 제거됐다. 부모 NativeERDCanvas와 wheel handler만 각 1회 호출됐다.
- 각 입력에서 카메라 transform 변화와 문서 fingerprint 불변 확인. 카드 선택 data-selected=true, 도메인 개요(도메인1/테이블0)와 공유 캔버스(테이블50) 전환 정상 확인.
- raw 결과와 스크린샷: artifacts/performance/2026-10-04-native-render-boundary (Git 제외). 수정 중 dirty=true 빌드의 기능/호출수 검증이며 프레임 성능의 정식 반복 baseline은 아니다.

## 남은 범위

부모 카메라/툴바 React 업데이트는 남는다. 기존 v1 UI의 Native 이식, 화면 밖 요소 제외, 변경 후 frame p95 비교는 아직 수행하지 않았다. 실제 운영 편집 저장·협업의 브라우저 end-to-end 검증 대신 기존 회귀와 최신 동작 참조 테스트를 사용했다. 기본 main과 원격/DB는 변경하지 않았다.
