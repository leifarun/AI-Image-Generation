export interface MarketplaceOption {
  code: string
  country: string
  domain: string
}

export const MARKETPLACE_OPTIONS: MarketplaceOption[] = [
  { code: 'US', country: '美国', domain: 'amazon.com' },
  { code: 'UK', country: '英国', domain: 'amazon.co.uk' },
  { code: 'DE', country: '德国', domain: 'amazon.de' },
  { code: 'JP', country: '日本', domain: 'amazon.co.jp' },
  { code: 'CA', country: '加拿大', domain: 'amazon.ca' },
  { code: 'FR', country: '法国', domain: 'amazon.fr' },
  { code: 'IT', country: '意大利', domain: 'amazon.it' },
  { code: 'ES', country: '西班牙', domain: 'amazon.es' },
  { code: 'AU', country: '澳大利亚', domain: 'amazon.com.au' },
  { code: 'AE', country: '阿联酋', domain: 'amazon.ae' },
  { code: 'SA', country: '沙特', domain: 'amazon.sa' }
]

export function formatMarketplaceLabel(code: string): string {
  const option = MARKETPLACE_OPTIONS.find((item) => item.code === code)
  return option ? `${option.code}（${option.country}）` : code
}
