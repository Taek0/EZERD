# 최신 Native 측정 어댑터

- Lab 제품 소스(features/components/app/server/model/contracts)는 origin/main 1ac4d6d와 일치하도록 merge했다. 기존 성능 도구를 보존했다.
- 새 NativeCanvasInlineCell을 포함하도록 comparison-only transform에서 memoized inlineContext를 전달한다. noSave callback을 유지하고 실제 계정/API를 사용하지 않는다. 단순 onEdit 버튼만 달았던 이전 editable-presentation과 DOM 구성이 다르므로 구분한다.
- pnpm format 및 production profiling 빌드(typecheck 포함) 통과. 제품 소스는 수정하지 않았다.
