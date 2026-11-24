import puppeteer from 'puppeteer-core'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = 'http://127.0.0.1:4173/'

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--user-data-dir=C:/Users/lenovo/WorkBuddy/2026-11-19-11-31-52/.workbuddy/pptr-profile']
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const logs = []
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
page.on('requestfailed', (req) => logs.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText}`))

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1500))

// 用正确的登录ID + 一个必然错误的密码，模拟"密码错误"场景
await page.type('input[placeholder="请输入登录 ID"]', '雷发润')
await page.type('input[placeholder="请输入密码"]', 'definitely-wrong-password-xyz')

// 监听所有网络请求，看登录时到底发了几次请求、都发到哪
const requests = []
page.on('request', (req) => {
  if (req.url().includes('supabase') || req.url().includes('auth')) {
    requests.push(`${req.method()} ${req.url().slice(0, 120)}`)
  }
})

await page.click('.login-btn')

// 轮询抓取错误提示
let result = null
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 500))
  result = await page.evaluate(() => {
    const msgs = document.querySelectorAll('.el-message__content')
    return {
      messages: Array.from(msgs).map((m) => m.textContent).filter(Boolean),
      buttonLoading: document.querySelector('.login-btn')?.classList.contains('is-loading') ?? false
    }
  })
  if (result.messages.length > 0) break
}

await browser.close()

console.log('=== 登录时发出的 Supabase 请求 ===')
console.log(requests.join('\n') || '(无请求)')
console.log('=== 登录结果 ===')
console.log(JSON.stringify(result, null, 2))
console.log('=== 控制台日志 ===')
console.log(logs.slice(0, 20).join('\n') || '(无)')
