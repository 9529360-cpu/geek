export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_FONT_COLOR = '#18A058';

const validSize = (size) => Number.isInteger(size) && size >= 10 && size <= 28;
const validColor = (color) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color);

export function accountDisplay(account) {
  return {
    fontSize: validSize(account.fontSize) ? account.fontSize : DEFAULT_FONT_SIZE,
    fontColor: validColor(account.fontColor) ? account.fontColor.toUpperCase() : DEFAULT_FONT_COLOR,
  };
}

export function displayFromFields(name, size, color) {
  const fontSize = Number(size);
  if (!validSize(fontSize) || !validColor(color)) throw 'APPEARANCE_INVALID';
  return { name: name.trim(), fontSize, fontColor: color.toUpperCase() };
}
