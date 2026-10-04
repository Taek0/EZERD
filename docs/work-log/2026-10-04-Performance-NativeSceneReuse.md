# Native 장면 중복 계산 제거 결과

2026-10-04. [계획](../planning/2026-10-04-Performance-NativeSceneReuse.md)에 따라 origin/main 8390e9e 반영 후 구현했다.

## 변경

- 개인 상태를 합친 기본 문서를 document/sharedSource/personal.state 기준으로 재사용한다.
- 기본 장면은 문서·뷰·표시 모드 변경 때만 계산한다.
- 초안이 없거나 비활성/미저장 미리보기 대상 또는 동일 좌표이면 기본 장면을 그대로 사용한다. 실제 이동 초안만 관계선을 다시 계산한다.
- 초안 적용 시 반복 find 대신 노드 ID Map을 사용한다. 기존 JSX/CSS와 입력·저장 계약은 유지했다.

## 검증

- 기존 두 번 계산 방식과 새 방식의 physical/logical 및 shared/domain/overview 기하 결과 동등성, 문서 불변, 비활성 초안 재사용, 이동 FK 갱신 회귀 테스트를 추가했다.
- NativeERDCanvas, 개인 캔버스, shared/private PNG, 계측 fixture 등 8파일 85테스트 통과.
- pnpm format/format:check, 공유 패키지 빌드, 웹 타입 검사, 일반 웹 production 빌드 및 perf:build 통과. 기존 번들 크기 경고는 유지된다.
- 브라우저에서 50테이블·500컬럼 fixture의 실제 wheel pan 및 Ctrl+wheel zoom 각각 장면 계산 nativeCanvasScene 0회, relationGeometry 0회 확인. 카메라 transform은 변했고 원본 fingerprint와 카드50개는 유지됐다.
- 측정 파일은 artifacts/performance/2026-10-04-native-scene-reuse에 보존했다. 수정 중 빌드(dirty=true)의 기능·호출수 검증이며 정식 속도 baseline으로 사용하지 않는다.

## 남은 범위

이번 수정은 장면 계산 재사용이다. 카메라 이동에서 React 하위 카드 렌더링과 nativeColumnTypeDisplay 호출(500회)은 남아 있다. 카메라/문서 렌더 경계 분리, UI 이식, 화면 밖 요소 제외는 후속 작업이다. 실제 운영 프로젝트 저장과 개인 상태 변경을 브라우저에서 수행하지 않았으며 해당 경로는 회귀 테스트로 확인했다. main checkout 및 운영 DB를 수정하지 않았고 이번 커밋은 원격 push하지 않았다.
