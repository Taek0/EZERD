# 원격 main 후속 반영 결과

- [계획](./2026-10-02-Git-MainFollowupPushPlan.md)에 따라 제품 기준점 `5b8f785016599eb6604ca0263d54bc9bcc95c08d`까지의 미반영 커밋 9개를 원격 main에 반영했다.
- 원격 시작점은 `e892fbf29a97abfb86c2bda5be497c34a2816775`였다. 계획 커밋 `836d3f0`과 이력 통합 커밋 `cea952e`를 포함해 일반 push했다. `git ls-remote`로 원격 main이 `cea952ec95886cef2ee175be95b2a98f698cac80`과 일치함을 확인했다.
- 병합 충돌은 없었다. 실제 병합 변경은 원격의 과거 문서 전용 push 계획·결과와 이전 main push 결과 기록, 총 3개 문서 추가뿐이다. 제품 tree와 `docs/EZERD.txt`는 요청 시점 커밋과 일치함을 확인했다.
- 원래 작업 폴더의 미커밋 제품 변경과 새 파일은 push하지 않았다. 이전 격리 worktree의 snapshot 복원은 불가능해 새 격리 worktree를 만들고 검증했다.

## 검증

- `pnpm install --frozen-lockfile`은 기존 의존성 store를 재사용했다. 공급망 정책 검사 통과, lockfile 변경 없음.
- 독립 checkout에서 `pnpm setup`으로 공개 예시 환경을 준비한 후 전체 `pnpm check`가 통과했다.
- 포맷·전체 타입 검사·테스트·서버/웹 빌드 성공. 테스트 159개 파일·1,826개 통과, 17개 파일·253개 건너뜀. 조건부 DB 통합 검사를 이번에 전부 새로 실행한 것으로 계산하지 않는다.
- Vite의 500 kB 초과 번들 경고는 남아 있다. 생성물·예시 `.env`·의존성 파일은 커밋에 포함하지 않았다.
- 제품 기준점 대비 이번 Git 기록 문서만 제외한 전체 tree diff, 병합 공백 검사와 clean checkout을 확인했다.

## 반영 목록

- `9657dd8`: 여러 탭의 durable 저장 요청 충돌 방지.
- `4336f94`: native 도메인 편집·개요 UI.
- `aa22d10`: 저장 요청 취소와 늦은 재전송 차단.
- `782fd7f`: 버전별 JSON 입출력·업그레이드 UI.
- `237d693`: 웹·MCP의 취소 확인.
- `5357d35`: 클립보드 검토·durable 붙여넣기.
- `2596fb4`: DB별 인덱스 방식 검증.
- `0a6f76f`: MySQL 문자셋·물리 크기 공통 정책.
- `5b8f785`: 검증된 signed integer의 DB 간 변환 계획.

## 마무리

- 이 결과 기록을 별도 커밋하고 같은 원격 main에 일반 push한 뒤 최종 HEAD를 확인한다. 원래 main이 계획 커밋 이후 그대로이면 문서 변경만 추가되는 fast-forward로 맞추고 미커밋 작업을 보존한다. 진행 중 새 제품 커밋이 생겼다면 로컬 브랜치를 재작성하지 않는다.
- GitHub는 push 때 의존성 취약점 10건(높음 5, 중간 4, 낮음 1)을 알렸다. [Dependabot 알림](https://github.com/Taek0/EZERD/security/dependabot)에서 후속 확인한다. 이번 작업에서 의존성 버전을 변경하지 않았다.
