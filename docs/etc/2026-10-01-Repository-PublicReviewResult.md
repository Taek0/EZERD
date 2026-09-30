# 저장소 공개 전환 점검 결과

## 범위와 결론

- [점검 계획](./2026-10-01-Repository-PublicReviewPlan.md)에 따라 로컬 추적 파일과 로컬의 모든 Git 참조에서 도달 가능한 308개 커밋을 확인했다. shallow clone은 아니다.
- 최우선 확인 사항은 Git에 포함된 Apple SD Gothic Neo 폰트의 공개 재배포·웹 제공 권한이다. 저장소의 설명과 자산 메타데이터만으로 권한을 확인할 수 없다.
- 검사한 주요 비밀정보 패턴에서 실제 인증정보로 확인된 항목은 없었다. 완전한 비밀정보 감사 또는 공개 가능 판정을 의미하지 않는다.
- 제품 코드, 공개 설정, 기존 Git 기록은 변경하지 않았다. 기존 미추적 작업 문서와 사용자 관리 `docs/EZERD.txt`도 변경하지 않았다.

## 실제 확인 사항

| 항목 | 확인 결과 | 필요한 조치 |
| --- | --- | --- |
| 폰트 자산 | `apps/web/public/fonts/apple-sd-gothic-neo/` 아래 WOFF 파일 600개가 추적된다. `scripts/import-fonts.mjs`와 manifest는 사용자 제공 자산이라고만 설명한다. | 원본 취득 경로와 적용 계약에서 웹 제공·공개 저장소 재배포·서브셋 제작 권한을 확인한다. 권한이 확인되지 않으면 재배포를 허용하는 폰트로 교체하는 방안을 우선 검토한다. |
| 외부 라이선스 고지 | `apps/web/THIRD_PARTY_NOTICES.md`는 사용자 제공 폰트 및 자체 앱 코드를 고지 적용 대상에서 제외한다. Untitled UI의 MIT 고지는 존재한다. | 기존 고지를 폰트나 자체 코드의 허가 근거로 사용하지 않는다. |
| 자체 프로젝트 라이선스 | 루트에서 추적되는 LICENSE 파일은 없다. | 포트폴리오 열람 목적인지, 타인의 사용·수정·재배포를 허용하려는지 정하고 README 또는 LICENSE로 명시한다. |
| 환경 파일 | `.env`는 ignore 처리되어 있고 추적 환경 파일은 `.env.example`뿐이다. 검사한 경로 패턴에서 과거 `.env`, 개인키, DB 덤프 파일은 발견하지 못했다. | 예시 DB 비밀번호를 실제 운영 자격증명으로 재사용하지 않는다. |
| 비밀정보 패턴 | 현재 텍스트 파일 708개와 Git diff의 추가 행에서 개인키, GitHub·AWS·OpenAI·Slack 자격증명, JWT, DB 자격증명 URL 패턴을 검사했다. EZERD의 `ezmcp_` 접두사와 실제 생성 길이도 현재 파일·과거 추가 행에서 별도로 검사했다. | GitHub secret scanning 알림을 확인하고 push protection 설정을 점검한다. 필요하면 전용 스캐너로 전체 감사를 보완한다. |
| DB URL 패턴 일치 | 현재 2곳, 과거 추가 행 3곳이 일치했다. `.env.example`의 로컬 예시와 오류정보 노출 방지 테스트의 가상 URL이었다. | 이번 일치 항목은 실제 운영 비밀정보로 분류하지 않았다. |
| 커밋 이메일 | 작성자·커미터 이메일 2종 모두 GitHub noreply 형식이 아니었다. 주소 원문은 기록하지 않았다. | 이메일 공개가 불필요하면 앞으로 GitHub noreply 주소로 커밋하도록 설정한다. 기존 커밋에는 이전 주소가 남는다. |
| 운영 문서 | `docs/work-log/2026-09-30-Workspace-ResumeCheckpoint.md`에 운영 MCP 서버의 사설 주소와 로그 경로가 기록되어 있다. | 내부 운영정보 공개가 의도된 것인지 검토하고 필요하면 예시 주소로 바꾼다. 사설 IP 자체를 인증정보 유출로 단정하지 않는다. |
| 자동화 | 현재 추적 파일 목록에서 `.github/` 워크플로 파일은 확인되지 않았다. | 과거 원격 Actions 실행·로그·아티팩트가 있었다면 별도로 확인한다. 향후 외부 PR 자동화에서 비밀정보와 쓰기 권한을 제공하는 방식은 주의한다. |

## 공개 전환 시 확인할 설정과 영향

- [GitHub 공개 전환 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility): 코드와 Actions 기록·로그가 공개된다. 최신 파일만 지우는 것으로 과거 노출을 해결할 수 없다.
- [민감정보 제거 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository): 실제 자격증명이 노출되었다면 먼저 폐기·재발급하고 필요한 기록 정리를 진행한다. 이번 점검에서는 기록 재작성이나 토큰 폐기를 실행하지 않았다.
- [저장소 라이선스 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository): 공개만으로 일반적인 사용·수정·재배포 허가가 생기지는 않는다. GitHub에서의 열람·fork는 가능하며, private으로 되돌려도 기존 복제본과 fork는 남을 수 있다.
- [Apple macOS 라이선스](https://www.apple.com/legal/sla/docs/macOSSequoia.pdf)의 2.E는 폰트 임베딩에 별도 제한이 적용됨을 설명한다. 이는 이번 파일의 실제 취득 계약을 확인한 결과가 아니므로 해당 자산의 위법 여부를 단정하지 않는다.
- [Secret scanning 설정](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning), [push protection 설정](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection), [보안 설정 빠른 시작](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository)을 참고해 보안 알림·유출 방지·Dependabot을 확인한다.
- [브랜치 보호](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)를 검토한다. 공개 저장소라고 일반 방문자에게 쓰기 권한이 부여되지는 않는다.
- [커밋 이메일 설정](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address): 설정 변경은 과거 커밋의 이메일을 바꾸지 않는다.

## 한계와 검증

- 원격 저장소를 fetch하지 않았다. 로컬 HEAD와 캐시된 `origin/main`은 다르므로 이번 결과는 GitHub의 현재 공개 파일과 모든 참조를 직접 검증한 결과가 아니다.
- 원격 보안 알림, 브랜치 보호, Actions 실행 기록, 삭제된 원격 브랜치, PR의 별도 참조, 이슈·댓글·첨부물은 확인하지 않았다.
- 주요 토큰 형식 중심의 자체 패턴 검사다. 임의 형식의 비밀번호·세션 토큰, 인코딩된 비밀정보, 이미지 내부 내용, 모든 개인정보와 계약상 비공개 정보까지 검증하지는 않았다. 현재 파일 검사에서는 NUL이 포함된 파일과 2MB 초과 파일을 제외했다.
- 문서 작성만 수행했으므로 제품 테스트는 실행하지 않았다. 문서는 루트 `.prettierignore`에 의해 포맷 대상에서 제외된다.
- `pnpm format:check`는 기존 제품 코드 13개 파일의 포맷 경고로 실패했다. 이번 점검은 해당 파일을 수정하지 않았고, 무관한 포맷 변경도 적용하지 않았다. 문서 변경 범위와 `git diff --check`를 별도로 확인한다.
