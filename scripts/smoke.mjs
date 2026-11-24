import puppeteer from 'puppeteer-core'
import path from 'node:path'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = 'http://127.0.0.1:4173/'
const SHOT = path.resolve('work/smoke-login.png')
const PROFILE_DIR = path.resolve('work/pptr-profile')

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${PROFILE_DIR}`]
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const consoleLogs = []
page.on('console', (msg) => {
  const loc = msg.location()
  consoleLogs.push(`[${msg.type()}] ${msg.text()} @ ${loc.url ?? ''}:${loc.lineNumber ?? '?'}`)
})
page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.stack ?? err.message}`))
page.on('response', (res) => {
  if (res.status() >= 400) consoleLogs.push(`[http${res.status()}] ${res.url()}`)
})

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))

const loginState = await page.evaluate(() => ({
  hasLoginCard: !!document.querySelector('.login-card'),
  loginDisabled: !!document.querySelector('.login-btn[disabled]'),
  hasLoginIdField: !!document.querySelector('input[placeholder="请输入登录 ID"]'),
  hasPreviewEntry: !!document.querySelector('.preview-entry'),
  bodyText: (document.body.innerText || '').slice(0, 200)
}))

await page.screenshot({ path: SHOT })
await browser.close()

console.log('=== 登录页状态 ===')
console.log(JSON.stringify(loginState, null, 2))
console.log('=== 控制台输出 ===')
console.log(consoleLogs.length ? consoleLogs.slice(0, 15).join('\n') : '(无输出)')
