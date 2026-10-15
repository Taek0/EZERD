import { registerTranslations } from '../../shared/i18n/index.js';
registerTranslations({
  선택안함: 'None',
  '(직접 입력)': '(Custom type)',
  '사용자 정의 타입': 'Custom type',
  '구조 설계로 시작': 'Start a structural model',
  'DB를 선택하지 않으면 공통 타입과 직접 입력한 타입으로 구조를 설계할 수 있습니다. DDL 내보내기는 사용할 수 없습니다.':
    'Without a database, you can model structures using common or custom types. DDL export is unavailable.',
  'DDL 내보내기 · DB 선택 필요': 'Export DDL · Database required',
  '구조 설계 · DDL 내보내기 불가': 'Structural model · DDL export unavailable',
});
