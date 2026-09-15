// Public, read-only pricing projection for the marketing surface.
// The subscription Worker remains the billing authority. The pricing contract
// must fail if these published values drift from its PLANS/FREE_QUOTA_CHARS.
export const FREE_QUOTA_CHARS = 20000;

export const PUBLIC_PRICING = Object.freeze([
  Object.freeze({ id: 'basic', name: '基础包', priceUsd: 25, chars: 1000000 }),
  Object.freeze({ id: 'standard', name: '标准包', priceUsd: 48, chars: 1500000 }),
  Object.freeze({ id: 'pro', name: '大包', priceUsd: 128, chars: 4500000 }),
]);

export function formatCharacterAmount(chars) {
  const value = Number(chars || 0);
  if (value >= 10000 && value % 10000 === 0) return `${value / 10000} 万`;
  return new Intl.NumberFormat('zh-CN').format(value);
}
