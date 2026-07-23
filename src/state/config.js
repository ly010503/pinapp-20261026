export const PATTERN_SIZES = [
  { id: 'mini', label: '迷你', width: 30, height: 30, description: '适合图标和简单图案' },
  { id: 'small', label: '小号', width: 40, height: 60, description: '适合简单头像' },
  { id: 'medium', label: '中号', width: 60, height: 90, description: '适合人物和宠物', recommended: true },
  { id: 'large', label: '大号', width: 80, height: 120, description: '细节更加丰富' },
];

export const COLOR_OPTIONS = [
  { value: 12, label: '最多 12 色', description: '材料较少，制作更轻松' },
  { value: 24, label: '最多 24 色', description: '效果和难度更均衡', recommended: true },
  { value: 36, label: '最多 36 色', description: '适合保留更多细节' },
  { value: 48, label: '最多 48 色', description: '尽量保留完整颜色' },
];

export const DEFAULT_SIZE = { width: 60, height: 90 };
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const sizeKey = ({ width, height }) => `${width}x${height}`;
