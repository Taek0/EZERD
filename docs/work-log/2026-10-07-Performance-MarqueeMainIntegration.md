# 영역 선택 PR 최신 main 통합 결과

- 원격 main 1037ab0을 PR #5의 codex/canvas-marquee-performance에 병합했다.
- NativeERDCanvas의 lostpointercapture 한 곳에서 충돌했다. main의 포인터 소유권 확인·marquee 종료 처리를 유지하고 PR의 예약 frame 취소를 결합했다.
- main의 신규 NativeERDCanvas.interaction.test는 사각형이 항상 mount되어 hidden 속성으로 표시되는 방식과 rAF 처리에 맞춰 테스트 환경을 갱신했다. 기존 테스트 및 assertion의 기능적 목적은 유지했다.
- main에 추가된 비보안 origin 오류 수정, 히스토리/UI, 원격 편집 중 gesture 유지, DB context 변경 시 초기화, 비차단 queued 편집/동시 property command 처리는 보존했다.
- 관련 회귀 5개 파일 / 21개 테스트 통과.
- pnpm format 및 pnpm check 통과: 227개 파일 / 2,804개 테스트 통과, 27개 파일 / 506개 환경 조건부 skip. 전체 타입·서버/웹 빌드 통과. 기존 bundle 크기 경고 유지.
- origin/main 대비 제품 차이는 기존 영역 선택 개선 4개 source/test 파일 및 신규 main 회귀 테스트 환경 수정 1개 파일이다. 계측 도구·원시 결과는 포함하지 않는다.
- 기존 프레임 계측은 이전 lab 구현 기준의 역사적 결과다. 최신 main 통합 후 시간 수치를 재계측한 것으로 표시하지 않는다.

[계획](../planning/2026-10-07-Performance-MarqueeMainIntegration.md) · [기존 계측](2026-10-07-Performance-MarqueeComparison.md) · [PR #5](https://github.com/Taek0/EZERD/pull/5)
