import puppeteer from 'puppeteer-core'

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = 'http://127.0.0.1:4173/'

// 从命令行参数读取登录 ID 和密码（不写死在脚本里）
const loginId = process.argv[2]
const password = process.argv[3]

if (!loginId || !password) {
  console.error('用法: node scripts/e2e-login.mjs <登录ID> <密码>')
  process.exit(1)
}

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

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1500))

// 登录
await page.type('input[placeholder="请输入登录 ID"]', loginId)
await page.type('input[placeholder="请输入密码"]', password)
await page.click('.login-btn')

// 等待跳转
let loggedIn = false
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const url = page.url()
  if (url.includes('#/dashboard') || url.includes('#/tasks')) {
    loggedIn = true
    break
  }
  // 检查错误消息
  const msg = await page.evaluate(() => document.querySelector('.el-message__content')?.textContent)
  if (msg) {
    console.log('登录报错:', msg)
    break
  }
}

if (loggedIn) {
  console.log('=== 登录成功，当前 URL:', page.url())
  // 导航到任务列表
  await page.goto(URL + '#/tasks', { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 3000))

  const state = await page.evaluate(() => {
    const table = document.querySelector('.vxe-table')
    const rows = document.querySelectorAll('.vxe-table--body .vxe-body--row').length
    const toolbar = document.querySelector('.table-toolbar')
    return {
      hasTable: !!table,
      rowCount: rows,
      hasNewTaskButton: !!toolbar?.querySelector('button'),
      bodyText: (document.body.innerText || '').slice(0, 400)
    }
  })
  console.log('=== 任务列表状态 ===')
  console.log(JSON.stringify(state, null, 2))
} else {
  console.log('=== 登录失败 ===')
  console.log('当前 URL:', page.url())
}

await browser.close()
console.log('=== 控制台日志 ===')
console.log(logs.slice(0, 20).join('\n') || '(无)')
