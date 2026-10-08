# 고급식 및 상세설계 UI 결과

계획: [UX 계획](../planning/2026-10-08-AdvancedExpression-UXPlan.md)

## 변경

- 고급 편집의 혼합 대상 목록을 항목 종류 → 해당 종류의 편집 대상 → 핵심 설정 순서로 변경했다. 기존 선택값과 복구 mounting key는 보존했다.
- 인덱스 방식은 기본 화면에서 선택하고 INCLUDE, 조건식, NULL 처리, invisible은 접힌 고급 옵션에서 편집한다. 정책별 disabled 판단은 유지했다.
- 복합 하위 식은 필요할 때 펼치고 단순 컬럼/리터럴은 바로 편집한다. 인덱스 키 순서/제거 버튼을 별도 작업 영역에 배치했다.
- NativeDesignDetails는 넓은 컬럼 표를 컬럼별 카드와 기본값/생성/DB 옵션 펼침 영역으로 교체했다. 원문, 사용자 속성, 인덱스 옵션, CHECK, ENUM 표시를 보존했다.
- CSS는 전용 파일과 기존 --line 토큰을 사용한다. 데이터 및 정책 모듈은 수정하지 않았다.
- MAIN의 자동저장 750ms 변경에 맞춰 담당 자동저장 테스트 타이머를 조정했다.

## MAIN 연계 API

```tsx
import { NativeDesignDetails } from './NativeDesignDetails.js';

<NativeDesignDetails document={doc} table={selectedTable} mode={mode} />;
```

- exported NativeDesignDetailsProps: document: NativeDesignDocument, table: NativeTable, mode: 'physical' | 'logical'.
- 자체 상세설계 PanelSection 및 CSS 포함. 기존 상세설계 PanelSection 전체를 대체한다.
- NativeLogicalModeProvider의 useNativeLogicalMode()를 내부 사용한다. OFF는 physical 표시, logical 전용 테이블은 숨긴다. ON은 전달된 mode를 따른다.
- Boyle에게 API를 전달했고 JSX 통합 완료 회신을 받았다. 이 작업에서는 NativeProjectView를 수정하지 않았다.

## 검증

- 전용 UI/상세설계, 자동저장, memo, 고급 정책, 식 트리 정책: 6개 파일 61개 테스트 통과.
- SSR 검증: 결정 순서, 복구 선택 초기화, 렌더 중 저장 없음, 복합 트리 접힘, 단순 피연산자 표시, 선택 옵션의 마운트 유지, 논리 provider 표시, 원문 escaping 및 데이터 불변성.
- 실행은 지정 Node 24.18.1을 사용했다. pnpm의 sandbox realpath EPERM 및 Vitest 기본 TEMP ENOENT 때문에 설치된 CLI를 직접 실행하고 TEMP/TMP를 node_modules/.cache/advanced-ux-temp로 지정했다.
- 전체 web 타입 검사는 공통 UI와 다수 기존 테스트 타입 오류로 실패했다. 담당 제품 컴포넌트의 오류는 없었다. 브라우저 시각 검증은 수행하지 않았다.
- 변경 파일만 Prettier 적용/확인. Git add/commit 및 전체 format은 실행하지 않았다.
