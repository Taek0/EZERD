export function userColorStyle(color?: string) {
  const background = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#4169e1';
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(background.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return { background, color: luminance > 0.22 ? '#17202b' : '#ffffff' };
}
