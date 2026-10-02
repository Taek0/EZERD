# GitHub 보안·브랜치 관리 실행 목록

## 완료된 저장소 파일 변경

- [내부 주소 정리](./2026-10-01-Repository-InternalAddressResult.md): 실제 주소가 있던 공개 문서 3개에 자리표시자를 적용했다. 로컬 설정과 과거 기록은 유지했다.
- [MIT 적용](./2026-10-01-Repository-MITLicenseResult.md): 루트 LICENSE·package.json·README에 반영했다. 외부 폰트·라이브러리는 별도 조건이다.
- 폰트는 사용자 결정에 따라 그대로 유지한다.

## GitHub에 바로 적용할 보안 설정

경로: [Settings → Advanced Security](https://github.com/Taek0/EZERD/settings/security_analysis).

| 항목 | 권장값 | 목적·순서 |
| --- | --- | --- |
| Secret Protection | Enable | secret scanning 알림을 사용할 수 있게 하고 최초 검사 완료 후 알림을 검토한다. |
| Push protection | On | Secret Protection 활성화 후 확인한다. 지원하는 비밀정보의 새 push를 차단한다. |
| Dependency graph | On | package.json과 lockfile의 의존성 정보를 수집한다. |
| Dependabot alerts | On | 알려진 의존성 취약점 알림을 받는다. |
| Private vulnerability reporting | Enable | 취약점을 공개 이슈 대신 비공개로 신고할 수 있게 한다. |
| CodeQL analysis | Default setup 검토 | JavaScript/TypeScript 분석을 구성하고 첫 분석을 확인한다. |

- [Secret scanning 설정](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning), [push protection 설정](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection), [저장소 보안 빠른 시작](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository)을 참고한다.
- [이전 실측 결과](./2026-10-01-Repository-PublicFollowupResult.md)에서는 Secret Protection·Dependency graph·Dependabot alerts가 꺼져 있고 CodeQL이 미설정이었다. 이번 문서는 설정 권장 목록이며 설정을 다시 읽거나 변경한 결과가 아니다.
- Dependabot의 자동 수정 PR과 정기 버전 업데이트는 알림 기능과 별개다. 프로젝트의 pnpm 11.24.0과 [공식 지원 표](https://docs.github.com/en/enterprise-cloud@latest/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)를 먼저 대조하고 lockfile 변경을 검증한 뒤 추가한다. 무검증 자동 병합은 사용하지 않는다.

## main 보호 설정

경로: [Settings → Rules → Rulesets](https://github.com/Taek0/EZERD/settings/rules). Branch ruleset을 만들고 대상을 main, Enforcement를 Active로 지정한다.

| 규칙 | 권장값 |
| --- | --- |
| Block force pushes | On |
| Restrict deletions | On |
| Require a pull request before merging | On |
| Required approvals | 현재 혼자 유지보수한다면 0. 다른 리뷰어가 참여하면 1 이상 검토. |
| Require conversation resolution | On |
| Require linear history | squash 또는 rebase 병합을 허용한 후 On 검토. |
| Require status checks to pass | 아래 CI 구성·성공 확인 후 체크 이름을 필수 지정. |
| Bypass list | 기본적으로 비워 두고, 필요할 때만 명시된 운영 예외를 최소화. |

- [공식 ruleset 규칙](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).
- PR 작성자는 자신의 PR을 승인할 수 없다. 혼자 개발하면서 승인 1개를 필수로 설정하면 병합이 막힐 수 있다. [공식 승인 안내](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).
- 이전 점검에서는 main 보호가 꺼져 있고 ruleset 목록이 비어 있었다. 실제 적용 시 저장소에 새로 설정된 규칙이 있는지 먼저 확인한다.

## CI 준비 후 적용할 항목

1. main 대상 PR과 main push에 GitHub Actions CI를 실행하도록 구성한다. 저장소가 지정한 Node·pnpm 버전으로 설치하고 `pnpm install --frozen-lockfile` 후 `pnpm check`를 실행한다.
2. 실제 GitHub 실행에서 포맷·타입·단위 테스트·빌드가 성공하는 것을 확인한다. 이 목록 작성 시 로컬 전체 `pnpm format:check`는 통과했지만, 원격 CI의 나머지 검사를 수행한 것은 아니다.
3. DB 기반 통합 테스트는 PostgreSQL 서비스와 격리 DB 구성을 준비한 뒤 별도 job으로 추가한다.
4. 성공한 검사 이름을 main의 Required status checks에 등록한다. 실행되지 않는 체크를 미리 필수 지정하지 않는다.
5. CodeQL도 첫 성공 실행을 확인한 뒤 필요하면 ruleset에서 결과를 요구한다.

## 병합·작업 운영

- Settings → General → Pull Requests에서 병합 후 브랜치 자동 삭제를 켠다.
- 작업 브랜치 → 작은 독립 커밋 → PR → 검증 → 병합 순서를 사용한다. main은 완성된 변경을 합치는 기준으로 둔다.
- PR 하나를 논리적 작업 하나로 정리한다면 squash가 적합하고, 독립 커밋을 main에도 유지하려면 rebase가 적합하다. 선형 기록을 선택하면 merge commit 방식은 사용하지 않는다.
- Actions 기본 token 권한은 `contents: read`처럼 최소화한다. 외부 PR에 운영 자격증명을 제공하거나 신뢰하지 않는 PR 코드를 `pull_request_target`의 강한 권한으로 실행하지 않는다. [Actions 보안 안내](https://docs.github.com/en/actions/reference/security/secure-use).

## 검증과 적용 상태

- [작성 계획](./2026-10-01-Repository-GitHubSettingsPlan.md)에 따라 사용자에게 보여줄 목록을 완성했다.
- 실제 GitHub 보안 설정·main ruleset·병합 옵션·CI는 변경하지 않았다. 저장소 파일 변경과 기록은 로컬 커밋까지 수행하며 원격 push는 수행하지 않는다.
- 관련 기록의 상대 링크 11개와 문서 인덱스 링크, 이번 변경의 diff 공백을 확인했다. 제품 코드 변경이 없어 제품 테스트는 수행하지 않았다.
