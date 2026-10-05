/** 与 packages/shared 枚举一致的中文展示项（中老年文案） */
export const EDUCATION_OPTIONS = [
  { value: 'JUNIOR_HIGH', label: '初中' },
  { value: 'HIGH_SCHOOL', label: '高中' },
  { value: 'VOCATIONAL', label: '中专' },
  { value: 'COLLEGE', label: '大专' },
  { value: 'BACHELOR', label: '本科' },
  { value: 'MASTER', label: '硕士' },
  { value: 'DOCTOR', label: '博士' },
];

export const INCOME_OPTIONS = [
  { value: 'BELOW_5K', label: '5千以下' },
  { value: 'R5K_10K', label: '5千-1万' },
  { value: 'R10K_20K', label: '1-2万' },
  { value: 'R20K_50K', label: '2-5万' },
  { value: 'ABOVE_50K', label: '5万以上' },
  { value: 'UNDISCLOSED', label: '保密' },
];

export const BODY_TYPE_OPTIONS = ['偏瘦', '标准', '偏胖'];

export const MARITAL_OPTIONS = [
  { value: 'UNMARRIED', label: '未婚' },
  { value: 'DIVORCED', label: '离异' },
  { value: 'WIDOWED', label: '丧偶' },
  { value: 'UNDISCLOSED', label: '保密' },
];

export function labelOf(options: Array<{ value: string; label: string }>, value?: string | null): string {
  return options.find((o) => o.value === value)?.label ?? value ?? '';
}
