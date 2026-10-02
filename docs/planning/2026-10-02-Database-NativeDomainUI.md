# Native 도메인 lifecycle UI 계획

- 작성일: 2026-10-02
- 기준 HEAD: `1ecfbfb`(main의 모델 단위 커밋은 별도 진행).
- 기준: [순수 모델/명령](2026-10-02-Database-NativeDomainLifecycle.md), [native canvas](2026-10-02-Database-NativeCanvas.md).
- 범위: 새 `NativeDomainEditor.tsx/test`, `NativeProjectView.tsx` content/focus, `NativeERDCanvas.tsx/test` domain overview/focus, 이 계획과 결과 문서. Hypatia 담당 format/structure/option-policy와 모델·서버·SQL export는 수정하지 않는다.

## 구현

1. 도메인 생성·metadata patch·명시 삭제 정책 및 테이블 domain 이동을 native structured command와 기존 NativeEditorForm에 연결한다.
2. 삭제는 rejectNonempty/moveTables/deleteTables를 명시하고, 전체 이동/삭제 영향과 외부 expression blocker를 표시한다. generated 연쇄 삭제는 명시 옵션으로 제공한다. 확인은 version/sequence/revision+정책에 묶어 새 저장 기준으로 넘어간 뒤 다시 확인하도록 한다.
3. user/project/object별 draft와 stable 생성 ID, 기대 revision, pending/ACK 보호를 기존 흐름으로 소비한다. canEdit/readonly/pending 및 legacy 원문은 보존한다. DB kind/타입 변경과 섞지 않는다.
4. overview 도메인 카드 선택/Enter가 도메인 편집에 focus한다. 배치가 없는 기존 도메인은 읽기용 카드로 표시하고 source를 합성 저장하지 않는다.
5. 작업 중 승인된 durable queue 비동기 API를 NativeProjectView에서 소비한다. pending load/stage/discard를 await하고 actor/project 세대·unmount·권한·저장 문맥을 확인한다. unknown/pending/sending 큐는 새 입력 전송을 차단하고 실패한 보관/폐기는 오류와 pending을 유지한다. main의 useNativeDurableState를 구독하며 queue/helper 자체는 수정하지 않는다.
6. LAN HTTP UUID 감사 후속: NativeERDCanvas의 제품 randomUUID 호출을 모두 nativeDurableId(getRandomValues)로 교체한다. randomUUID/subtle 없는 crypto로 canvas 신규 참조·개인 pending·action form과 domain 생성 form을 검증한다. 실제 LAN browser QA는 main 담당이다.

## 검증

- targeted static UI/command 테스트: metadata만 patch, 세 DB 원본 불변, 명시 삭제/이동/외부 blocker/cascade, stale 확인 토큰, clean 저장 비활성, 권한·pending readonly, overview 카드/focus 계약.
- 변경 파일 Prettier와 최신 소스 참조 웹 typecheck만 수행한다. 실제 메뉴·브라우저·HTTP/MCP 통합 QA 및 git commit은 main 담당이다.
