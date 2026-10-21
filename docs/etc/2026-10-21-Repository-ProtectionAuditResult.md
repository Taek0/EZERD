# 원격 저장소 보호 설정 검토 결과

- 점검일: 2026-10-21 (Asia/Seoul)
- 대상: [Taek0/EZERD](https://github.com/Taek0/EZERD), 공개 저장소, 기본 브랜치 `main`
- 점검한 원격 main: `5aebbee852f8d142a5ed0215948e53e0691b0cdf`
- [계획](./2026-10-21-Repository-ProtectionAuditPlan.md)에 따른 읽기 전용 점검이다. 원격 설정·제품 코드·`docs/EZERD.txt`는 변경하지 않는다.

## 판단

일반 외부 사용자에게 원본 쓰기 권한이 자동 부여되지는 않는다. 그러나 쓰기 권한 보유자의 main 직접 변경을 막는 보호가 현재 작동하지 않으며, 사용자가 제시한 PR 승인·자동 테스트 필수 통과 기준을 충족하지 못한다.

가장 큰 원인은 기존 `ezerd` ruleset의 대상 브랜치가 비어 있다는 점이다. Active 표시만으로 main 보호가 적용되는 상태가 아니다.

## 체크리스트 판정

| 항목 | 판정 | 실제 확인 내용 |
| --- | --- | --- |
| main 보호 규칙 적용 | 미충족 | ruleset은 Active지만 대상이 없음. main API의 `protected`는 `false`. |
| PR 최소 1명 승인 | 미충족 | `required_approving_review_count: 0`. PR 경유 규칙 자체도 적용 대상이 없음. |
| 자동 테스트 통과 후 병합 | 미충족 | required status checks 규칙이 없고, 원격 기본 브랜치에 `.github` 디렉터리도 없음. 최신 main의 검사는 CodeQL 1개뿐. |
| 커밋 변경 시 재승인 | 미충족 | `dismiss_stale_reviews_on_push: false`, `require_last_push_approval: false`. |
| Force push·브랜치 삭제 금지 | 미충족 | `non_fast_forward`, `deletion` 규칙은 있으나 적용 대상이 없어 main에 강제되지 않음. 기본 브랜치 삭제에 대한 GitHub 자체 제한과 별개로 평가. |
| 외부 PR Actions 실행·권한 제한 | 기본 충족 | 최초 기여자는 실행 승인 필요. 기본 토큰은 contents/packages 읽기 전용. Actions의 PR 생성·승인은 비활성. 모든 외부 기여자 승인 정책은 아님. |
| 스팸 발생 시 Interaction Limits | 현재 비활성·조건부 | 임시 제한 3종은 모두 Enable 상태, 외부 사용자의 동시 open PR 수는 무제한. 평상시 비활성 자체를 보안 결함으로 보지는 않음. |

## main 보호의 실제 적용 상태

근거: [ruleset 원문](https://api.github.com/repos/Taek0/EZERD/rulesets/24258197), [ruleset 화면](https://github.com/Taek0/EZERD/rules/24258197), [main API](https://api.github.com/repos/Taek0/EZERD/branches/main).

- ruleset 이름 `ezerd`, ID `24258197`, Enforcement `active`.
- `conditions.ref_name.include: []`, `exclude: []`.
- GitHub 화면은 대상 리소스가 없어 적용되지 않는다고 명시하고, Target branches에서 브랜치 대상 설정이 없음을 표시한다.
- 등록된 규칙은 삭제 제한, force push 제한, PR 경유, 선형 기록이다. PR 내 미해결 리뷰 대화 해소 요구도 켜져 있다.
- `bypass_actors: []`, `current_user_can_bypass: never`다. 우회 목록이 비어 있는 설정은 적절하나, 대상이 없는 상태에서는 보호 효과가 없다.
- PR 승인 수 0, stale approval 무효화·마지막 push 승인·CODEOWNERS 승인은 모두 비활성이다.
- `required_status_checks`와 code scanning 결과 요구 규칙은 없다. main API의 required checks 목록도 비어 있다.
- 보호 동작 검증을 위한 실제 push·force push·브랜치 삭제는 시도하지 않았다.

## 접근 권한과 PR 운영

- 개인 계정 Taek0 소유의 public 저장소다. 공개 열람·clone·fork와 원본 쓰기 권한은 별개다. GitHub의 [개인 저장소 권한 문서](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)에 따라 소유자와 초대된 collaborators가 쓰기 권한을 가진다.
- General 화면의 Issue·PR 생성 대상은 모두 All users다. 이는 원본 코드 쓰기 권한 부여를 의미하지 않는다.
- 최근 병합 PR 5개(#10–#14)가 main을 대상으로 존재한다. PR 사용 이력은 있으나 강제 설정의 근거는 아니다.
- [PR #14](https://github.com/Taek0/EZERD/pull/14)는 병합되었으며 [reviews API](https://api.github.com/repos/Taek0/EZERD/pulls/14/reviews) 결과는 빈 배열이다. 정식 GitHub review가 없다는 의미이며, 별도 도구·대화·로컬 검토의 부재까지 입증하지 않는다.
- 사용자 직접 추가 인증 후 [Collaborators 화면](https://github.com/Taek0/EZERD/settings/access)을 확인했다. 직접 접근 권한을 가진 collaborator는 0명이며, 초대한 collaborator가 없다고 표시된다. 사람 계정 기준으로 현재 소유자 외 추가 협업자의 쓰기 권한은 없다. 설치된 앱·deploy key 권한 전체에 대한 감사 결과는 아니다.
- General 화면에서 병합 후 head branch 자동 삭제는 켜져 있다. main 삭제 제한과는 다른 설정이다.

## 자동 검사와 Actions

근거: [최신 실행](https://github.com/Taek0/EZERD/actions/runs/39549633462), [최신 커밋 검사](https://api.github.com/repos/Taek0/EZERD/commits/5aebbee852f8d142a5ed0215948e53e0691b0cdf/check-runs), [Actions 설정](https://github.com/Taek0/EZERD/settings/actions).

- Actions runs API 총 107건, 조회한 최신 5건은 `dynamic/github-code-scanning/codeql` 실행이며 모두 success다. 최신 실행의 job은 `Analyze (javascript-typescript)`이고 CodeQL 분석 단계가 성공했다. 이는 분석 작업 성공이며 발견된 보안 경고가 0개라는 뜻은 아니다.
- 기본 브랜치 `.github` contents API는 404이며, 해당 커밋의 check-runs는 CodeQL 1개다. 저장소에 정의된 포맷·타입·단위 테스트·빌드 CI는 확인되지 않는다.
- 원격 `package.json`에는 `pnpm check`가 있고, 포맷 → 타입 검사 → 테스트 → 빌드를 수행한다. 스크립트 존재만으로 GitHub에서 실행되거나 병합 조건이 되는 것은 아니다.
- Actions 기본 토큰: Read repository contents and packages permissions.
- Allow GitHub Actions to create and approve pull requests: Off.
- Fork PR 실행 승인: Require approval for first-time contributors. 이전에 기여가 병합된 외부 사용자는 이 승인 정책만으로 매번 재승인 대상이 되지 않는다.
- Allow all actions and reusable workflows: On. full-length commit SHA 고정 요구는 Off. 향후 자체 워크플로 추가 시 third-party action을 검토하고 SHA 고정하는 보완을 권한다.
- 저장소에 정의된 `pull_request_target` 워크플로는 현재 `.github`가 없어 확인되지 않는다. 비밀정보 원문, 배포 환경, 앱·deploy key 전체 권한은 이번 검사 범위에 포함하지 않는다.
- GitHub의 [Actions 설정 문서](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)는 기본 토큰 권한과 workflow YAML의 세부 권한을 구분한다. 기본 읽기 권한만으로 향후 모든 워크플로의 최소 권한을 보장하지는 않는다.

## 스팸 대응

근거: [Interaction limits](https://github.com/Taek0/EZERD/settings/interaction_limits).

- existing users·prior contributors·repository collaborators 대상 임시 제한이 모두 꺼져 있다.
- Limit open pull requests from users without write access: Off. 화면에 동시 PR 수 무제한이 명시되어 있다.
- 점검 시 repository API의 open issues/PR 합계는 0이지만, 이 수치만으로 과거·현재 댓글 스팸이 없다고 판정하지 않는다. 이슈·댓글 전체 감사는 수행하지 않았다.
- 스팸 발생 시 [공식 안내](https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository)에 따라 임시 Interaction Limits를 적용할 수 있다. 동시 PR 수 상한은 별도의 지속 설정이다.

## 권장 적용 순서

1. 기존 `ezerd` ruleset의 Target branches에 Default branch 또는 `main`을 추가한다. Active와 빈 bypass 목록을 유지한다. 이 변경만으로 이미 선택된 PR 경유·force push 제한·삭제 제한·선형 기록이 실제 대상으로 적용된다.
2. 독립 리뷰어가 있다면 required approvals를 최소 1로 바꾸고 stale approval 무효화를 켠다. 현재 collaborator가 0명이므로 본인 PR에 승인 1명을 필수로 요구하면 다른 승인 가능한 리뷰어를 확보하기 전까지 병합이 막힌다. [GitHub는 PR 작성자의 자기 승인을 허용하지 않는다](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews). 혼자 운영하면서 0명을 유지하는 선택은 제시된 최소 1명 기준을 충족하지 않는다.
3. main 대상 PR·main push에서 지정된 Node/pnpm 버전과 frozen lockfile로 `pnpm check`를 실행하는 CI를 구성한다. 실제 GitHub 성공을 확인한 검사 이름을 required status checks에 등록한다. DB 통합 검사는 별도 DB 환경을 준비한다.
4. CodeQL 결과도 병합 전에 요구할지 정한다. 분석 실행과 병합 차단은 별개다. [ruleset 규칙 문서](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)를 기준으로 구성한다.
5. 외부 PR을 더 보수적으로 운영하려면 승인 대상을 all external contributors로 확대한다. 기본 토큰 읽기 전용과 PR 생성·승인 비활성을 유지한다.
6. 스팸이 생기면 임시 제한을 적용하고, 필요하면 외부 사용자 동시 PR 상한을 설정한다.

## 조회 한계와 검증

- GitHub CLI 인증이 유효하지 않아 CLI 설정 조회에 의존하지 않았다.
- 연결된 GitHub 도구는 branch protection 상세 API에 403을 반환했다. 이를 보호 미설정의 근거로 사용하지 않았다. ruleset 상세, main 공개 API, GitHub ruleset 화면으로 적용되지 않는 상태를 교차 확인했다.
- 일부 API 경로는 연결 도구의 허용 범위 밖이었다. Actions 권한·Interaction Limits는 로그인된 GitHub 설정 화면으로 확인했다.
- 로컬 HEAD는 원격 main과 다를 수 있어 원격 기본 브랜치를 직접 조회했다. 이전 2026-10-01 기록을 현재 상태의 근거로 재사용하지 않았다.
- 이번 변경은 계획·결과 Markdown 문서뿐이다. `.prettierignore`가 docs와 Markdown을 제외한다. 제품 테스트와 전체 포맷 적용은 수행하지 않는다.
- 문서 상대 링크는 모두 유효하다. `pnpm format:check`는 Corepack이 지정된 pnpm 11.24.0을 내려받는 단계에서 registry.npmjs.org DNS 조회 오류(`ENOTFOUND`)로 중단되어 Prettier 검사에 도달하지 못했다. 대신 기존 설치된 Prettier를 `node node_modules/prettier/bin/prettier.cjs --check .`로 직접 실행하여 동일한 전체 포맷 검사를 통과했다. 이번 문서는 ignore 대상이며 포맷 검사 대상에는 포함되지 않는다. 두 문서만 stage한 후 diff 공백과 변경 범위를 별도 확인했다.
