# 공개 저장소 후속 점검 결과

## 범위

- [계획](./2026-10-01-Repository-PublicFollowupPlan.md)에 따른 공식 자료 조사, 원격 저장소 API 조회, 로그인된 GitHub 화면 확인 및 로컬 비밀정보 검사 결과다.
- 사용자는 이메일 공개와 공개 후 복제본의 잔존을 수용했다. 이메일·Git 기록·라이선스·폰트·GitHub 설정은 변경하지 않았다.
- 기존 제품 개발 작업은 별도로 진행 중이다. 이 점검의 문서만 커밋하고 다른 작업은 포함하지 않는다. `docs/EZERD.txt`는 수정하지 않는다.

## 1. Apple SD Gothic Neo

- 사용자가 언급한 것과 같은 상업적 사용 설명이 [fonts-archive/AppleSDGothicNeo](https://github.com/fonts-archive/AppleSDGothicNeo)에 있다. 이 저장소는 Apple의 공식 사용 허가서가 아니므로 재배포 권한의 최종 근거로 사용할 수 없다.
- [Apple macOS Tahoe 26 공식 약관](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf) 2.E는 Apple 소프트웨어를 실행하면서 포함된 폰트를 사용해 콘텐츠를 표시·인쇄하는 것을 허용하며, 폰트 임베딩은 해당 폰트의 별도 임베딩 제한에 따른다고 명시한다. 2.N은 별도로 허용되지 않은 복사·변형 등을 제한한다.
- 해석: 적법하게 설치된 Mac에서 폰트를 이용해 상업적인 디자인·인쇄 결과물을 만드는 설명에는 근거가 있다. 단순히 Apple 기기를 하나 보유했다는 사실이 모든 운영체제에서의 폰트 파일 사용·변형·웹 배포·공개 저장소 재배포까지 허용한다는 결론은 공식 약관에서 확인하지 못했다.
- 현재 제품은 `@font-face`와 WOFF 파일을 직접 제공한다. CSS에서 기기에 설치된 폰트 이름을 참조하는 사용과 구별해야 한다.
- 굵기별 첫 WOFF 서브셋 5개에서 OS/2의 `fsType`이 0인 것을 확인했다. [OpenType 명세](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype)상의 임베딩 플래그이며, 이 서브셋들에는 name ID 0·13·14의 저작권·라이선스 설명·URL을 찾지 못했다. 변환된 파일의 플래그만으로 원본 취득 경로나 standalone 재배포 권한을 입증하지는 못한다.
- 권장 선택: 원본 취득 계약에서 재배포 허가를 확인하거나, Apple 폰트를 시스템 폰트 이름으로만 참조하고 파일 제공은 중단하는 방안을 검토한다. 플랫폼 간 동일한 모습이 필요하면 [Pretendard의 OFL](https://github.com/orioncactus/pretendard/blob/main/LICENSE)처럼 재배포 조건이 명확한 폰트를 사용한다. 이번에는 교체하지 않았다.

## 2. 비밀정보 및 GitHub 보안 상태

- 공식 [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)의 Windows 실행파일을 임시 폴더에 내려받았다. GitHub 릴리스 메타데이터의 SHA-256과 ZIP을 대조하고 일치한 후 실행했다. 시스템 PATH나 프로젝트 의존성을 변경하지 않았다.
- 공개 저장소를 임시 mirror로 복제해 다른 브랜치와 공개 PR head 참조까지 검사했다. mirror는 도달 가능한 커밋 321개를 포함하며, Gitleaks의 patch 검사 완료 로그에는 317개 커밋이 표시된다. 로컬 Git 검사 완료 로그에는 309개 커밋이 표시됐다. 검사 시점의 로컬 도달 가능한 커밋 수는 313개였다. merge 등 diff 검사 방식에 따라 수치가 다를 수 있다.
- 기본 규칙을 사용했고, 원격 mirror에서는 기본 규칙에 EZERD MCP 토큰 형식 `ezmcp_` + base64url 43자를 추가한 검사도 수행했다. 로그·보고서는 `--redact=100`으로 마스킹했다.
- 기본 및 확장 검사에서 실제 인증정보로 확인된 항목은 없었다. 유일한 검출은 `apps/server/scripts/workspace-transfer.mjs:9`의 DB `tokenId` UUID이며, MCP 인증은 `ezmcp_` 원문 토큰의 SHA-256을 `tokenHash`와 비교한다. DB 레코드 ID만으로 인증할 수 있는 구조는 아니다.
- 단, 위 운영 이관 스크립트에는 실제 사용자·공간·프로젝트 ID와 이름이 포함되어 있다. 인증 비밀정보와 별개로 공개할 필요가 없는 운영 데이터인지 검토할 가치가 있다. 재사용 스크립트로 유지하려면 실제 대상 목록은 비공개 입력 파일로 분리하는 방안을 권한다.
- 로컬 `.env`의 비밀정보 성격 변수값을 원문 출력 없이 공개 Git diff와 대조했다. DB 비밀번호가 공개 기록과 일치했으며, 추가 비교 결과 `.env.example`의 개발용 비밀번호와 같고 로컬 DB 호스트는 loopback이었다. 이는 공개된 예시값의 로컬 개발 사용이며, 운영 DB에 같은 비밀번호를 사용하는지까지 확인한 것은 아니다.
- 로그인된 [GitHub 보안 알림 화면](https://github.com/Taek0/EZERD/security/secret-scanning)은 `Secret scanning is not enabled`를 표시했다. [Advanced Security](https://github.com/Taek0/EZERD/settings/security_analysis)에서 Secret Protection은 Enable 상태, Dependency graph와 Dependabot alerts는 Off였다. CodeQL도 Set up 상태였다.
- 공개 저장소의 공급자 대상 자동 partner scanning과 소유자에게 제공되는 Secret Protection 알림 설정을 혼동하지 않는다. 이번 저장소에서 소유자 알림을 확인할 수 있는 기능이 활성화되지 않은 상태이므로 알림 0건이라고 보고하지 않는다.
- 원격 Actions runs API는 `total_count: 0`이었다. 이것으로 삭제된 과거 로그·아티팩트의 부재까지 입증하지는 않는다.
- 권장: Secret Protection과 push protection을 활성화하고 스캔 완료 후 알림을 확인한다. Dependency graph와 Dependabot alerts도 활성화한다. 이번 요청은 점검·조언이므로 해당 설정을 바꾸지 않았다.
- 한계: 스캐너의 패턴·엔트로피 검사이며 실제 토큰 유효성 확인을 외부 공급자에게 요청하지 않았다. 이미 삭제된 원격 참조, 이슈·댓글 전체, 비공개 첨부물, 모든 바이너리·이미지의 내부 내용까지 검사하지 않았다.

## 3. 내부 주소 처리

- `docs/work-log/2026-09-30-Workspace-ResumeCheckpoint.md:35`에는 실제 운영 MCP 주소가 있다.
- `docs/planning/2026-09-17-Hosting-LanCidr.md:5`와 `docs/work-log/2026-09-17-Hosting-LanCidr.md:4`에는 당시 실제 장치 주소·허용 대역이 있다.
- `docs/work-log/LAN_HOSTING.md`는 기존 주소를 형식 설명용 placeholder라고 이미 명시한다. 실제 값과 예시값을 구분해서 정리한다.
- 실제 운영값은 `<host-private-ip>`, `<approved-private-cidr>` 등으로 바꾸고, 실제 설정은 ignore 처리된 `.env` 또는 비공개 운영 문서에 보관하는 방안을 권장한다. 실행 가능한 예시를 제공한다면 명시적으로 예시라고 적는다.
- [RFC 1918](https://www.rfc-editor.org/rfc/rfc1918)에 따른 사설 IP의 노출만으로 인터넷에서 해당 호스트에 바로 접근할 수 있게 되는 것은 아니다. 이번 주소만을 이유로 과거 기록 전체 재작성이나 서버 주소 변경을 권하지 않는다. 공개 목적과 내부 정책이 별도 삭제를 요구한다면 범위를 정해 처리한다.
- 서버의 실제 접근 보호는 방화벽·허용 CIDR·인증에서 유지해야 한다. 주소를 숨기는 것으로 접근 제어를 대신할 수 없다. 이번에는 문서의 실제 주소도 수정하지 않았다.

## 4. 라이선스 선택지

| 선택 | 사용·배포 조건 | 선택에 맞는 의도 |
| --- | --- | --- |
| [MIT](https://choosealicense.com/licenses/mit/) | 상업적 사용·수정·배포 허용. 저작권·허가문 유지. 수정본 소스 공개 의무 없음. | 개인 포트폴리오 겸 자유로운 재사용 |
| [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | 상업적 사용·수정·배포 허용. 명시적 기여자 특허 라이선스, 수정 표시와 관련 고지 의무. | 기업 도입과 기여를 고려한 허용적 공개 |
| [MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/) | 배포 시 적용 대상 파일과 변경분의 소스 제공 의무. 별도 파일의 더 큰 제품은 다른 조건 가능. | 자체 파일의 개선분은 공개로 유지 |
| [GPL-3.0](https://choosealicense.com/licenses/gpl-3.0/) | 적용 대상 프로그램·파생물 배포 시 해당 소스와 같은 라이선스 제공 의무. | 배포되는 파생 프로그램의 공개 유지 |
| [AGPL-3.0](https://choosealicense.com/licenses/agpl-3.0/) | GPL 계열의 배포 조건에 더해 수정본의 네트워크 이용자에게 해당 소스 제공 기회를 제공해야 함. | 수정된 서버를 서비스하는 경우에도 개선분 공개 요구 |
| [별도 사용 허가 없음](https://choosealicense.com/no-permission/) | 일반 사용·재배포 권한을 부여하지 않는다. GitHub 열람·fork 및 법률상 예외는 별개다. | 코드 열람을 주된 목적으로 공개 |

- 위 오픈소스 라이선스는 상업적 사용을 허용한다. AGPL이 상업용 금지나 SaaS 금지인 것은 아니다.
- 이 프로젝트에서 타인의 재사용을 수용한다면 MIT가 간단한 선택이다. 서비스 파생본의 소스 공개가 목적이라면 AGPL, 열람만 허용하려면 별도 사용 허가를 부여하지 않는 의도를 명시하는 선택을 검토한다.
- 적용 대상은 사용자가 권리를 가진 자체 코드다. 외부 라이브러리·폰트의 별도 조건과 고지는 유지해야 하며, 루트 LICENSE 추가가 권한 불명인 폰트 재배포 문제를 해결하지는 않는다.
- 사용자 선택이 아직 없으므로 LICENSE를 추가하지 않았다.

## 6. GitHub 관리 권장안

- 원격 API 조회 시 public, 기본 브랜치 main, main의 `protected: false`, rulesets 목록은 빈 배열이었다. [브랜치](https://api.github.com/repos/Taek0/EZERD/branches/main), [rulesets](https://api.github.com/repos/Taek0/EZERD/rulesets).
- GitHub 기본 설정 화면에서 merge commit·squash·rebase 세 방식은 모두 허용되어 있고 병합 후 브랜치 자동 삭제는 꺼져 있었다.
- 공개 저장소는 GitHub Free에서도 [branch ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)을 사용할 수 있다. Settings → Rules → Rulesets에서 main 대상으로 Active ruleset을 만드는 방식이 적합하다.

| 규칙 | 현재 개인 개발에 권장하는 값 |
| --- | --- |
| 대상 | `main` |
| Block force pushes | On |
| Restrict deletions | On |
| Require a pull request before merging | On |
| Required approvals | 혼자 유지보수한다면 0. 다른 리뷰어가 참여하면 1 이상 검토 |
| Require conversation resolution | On |
| Require status checks | CI를 먼저 구성하고 실제 체크가 성공한 뒤 필수 지정 |
| Require linear history | squash 또는 rebase 방식과 함께 On 검토 |
| Bypass | 일상적인 우회 사용을 피하고 필요한 운영 예외만 최소화 |

- [GitHub 리뷰 안내](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews): PR 작성자는 자신의 PR을 승인할 수 없다. 혼자 개발할 때 승인 1개를 필수로 정하면 본인 PR 병합이 막힐 수 있다.
- CI는 저장소의 기존 `pnpm check`(포맷·타입·테스트·빌드)를 기본으로 설계할 수 있다. 현재 다른 작업에서 포맷 실패가 관찰된 상태이므로 먼저 정상 통과하도록 만든다. DB를 사용하는 integration 테스트는 별도의 PostgreSQL 서비스 구성 후 추가한다. 존재하지 않는 체크를 미리 필수 지정하지 않는다.
- 작업은 `codex/<task>` 또는 기능 브랜치 → 작은 커밋 → PR → 검사 → squash/rebase 병합으로 진행한다. 관련 없는 작업을 한 PR에 섞지 않는다. 작은 독립 커밋을 유지하려면 rebase 병합, PR 하나가 논리적 작업 하나라면 squash 병합이 적합하다.
- 병합 후 브랜치 자동 삭제를 활성화하고, 비밀정보 알림·의존성 알림·CodeQL 기본 분석·비공개 취약점 신고를 순차 적용하는 방안을 권한다.
- 정기 의존성 업데이트를 추가한다면 프로젝트의 pnpm 11.24.0과 Dependabot 지원 범위를 먼저 대조한다. [현재 지원 표](https://docs.github.com/en/enterprise-cloud@latest/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)는 pnpm v7–v10을 열거한다. pnpm 11의 lockfile 변경을 무검증 자동 병합하지 않는다. alerts 설정과 version update PR 자동화는 별개다.
- [Actions 보안 안내](https://docs.github.com/en/actions/reference/security/secure-use)에 따라 기본 token 권한은 최소한의 읽기로 설정하고 외부 PR에는 운영 비밀정보를 제공하지 않는다. 신뢰하지 않는 PR 코드를 `pull_request_target`의 강한 권한으로 실행하지 않는다.
- GitHub settings를 이번 점검 중 저장하거나 변경하지 않았다.

## 검증 기록

- 비밀정보 스캔은 위 범위에서 실제 수행했다. 실행 오류가 발생했던 초기 mirror 스캔은 결과로 사용하지 않았고, 경로별 임시 Git 설정으로 소유권 확인 문제를 해결한 뒤 317개 커밋 검사 완료를 확인했다. 전역 Git safe.directory 설정은 변경하지 않았다.
- 제품 코드 변경 없이 조사 문서만 작성했으므로 제품 테스트와 전체 포맷 적용은 수행하지 않는다. 문서는 루트 `.prettierignore`에서 제외된다. 커밋 전 이번 두 문서에 한정해 diff 공백 검사를 수행한다.
