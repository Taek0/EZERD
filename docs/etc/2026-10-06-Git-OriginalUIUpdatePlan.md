# 원본 UI 복원 PR 갱신 계획

- 대상: 기존 Draft PR #2, codex/native-canvas-interaction-performance.
- 원격 main 8390e9e 및 PR 원격 HEAD 2c63f0b를 확인했다.
- Lab의 원본 컴포넌트/모션/Native 상호작용 코드와 관련 제품 문서만 반영한다. 성능 스크립트, synthetic 예제, artifacts 원시는 제외한다.
- 독립 제품 pnpm check 통과 후 후속 memo/접근성 변경도 typecheck 및 format:check로 확인했다.
- fast-forward push로 원격 별도 브랜치를 갱신하고 PR 설명을 최종 범위로 교체한다. main의 파일과 브랜치는 변경하지 않는다.
