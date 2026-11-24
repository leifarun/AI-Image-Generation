// ============================================================
// process-task Edge Function：任务处理器
// 职责：领取任务 → 抓取亚马逊资料 → 组装指令 → 调用豆包 → 保存结果
// 触发：cron 定时 + 任务提交后前端主动调用
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

// 环境变量（在 Supabase 控制台 Edge Function Secrets 里配置）
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ARK_API_KEY = Deno.env.get('ARK_API_KEY') || ''
const ARK_BASE_URL = Deno.env.get('ARK_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3'

const FALLBACK_DOUBAO_MODEL = Deno.env.get('DOUBAO_MODEL') || 'doubao-seedream-4-5-251128'

// 诊断：确认关键环境变量是否注入（不打印明文，只看是否存在）
console.log('[诊断] SUPABASE_URL 存在:', !!Deno.env.get('SUPABASE_URL'))
console.log('[诊断] SERVICE_ROLE_KEY 存在:', !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
console.log('[诊断] ANON_KEY 存在:', !!Deno.env.get('SUPABASE_ANON_KEY'))
console.log('[诊断] ARK_API_KEY 存在:', !!ARK_API_KEY)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ---------- 类型 ----------
interface TaskRow {
  id: string
  asin: string
  marketplace: string
  selling_points: string
  template_id: string | null
  template_content: string | null
  product_title: string | null
  brand_name: string | null
  product_bullets: string[] | null
  product_images: string[] | null
  fetch_mode: 'auto' | 'manual' | null
  status: string
  prompt_assembled: string | null
  image_count: number
  subtemplate_ids: string[] | null
}

// ---------- 主入口 ----------
Deno.serve(async (req) => {
  // 健康检查
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, service: 'process-task' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const processed = await processQueue()
    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('process-task error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

// ---------- 队列处理 ----------
async function processQueue(): Promise<number> {
  let processed = 0

  // 0. 自愈：把"生成中超时"的任务重置回排队（防止僵尸任务）
  await healStuckTasks()

  // 每轮只处理 1 个任务：多图任务逐张生成，避免单次调用超时
  for (let i = 0; i < 1; i++) {
    // 1. 原子领取一个排队中的任务（置为 generating）
    const { data: taskId, error: claimError } = await supabase.rpc('claim_next_task')
    if (claimError) {
      console.error('claim_next_task error:', claimError)
      break
    }
    if (!taskId) break // 没有可领取的任务（队列空或并发已满）

    try {
      await handleTask(taskId)
    } catch (e) {
      // 处理中途崩溃 → 立即把任务重置回 queued，避免僵尸
      console.error('handleTask 异常，重置任务', taskId, e)
      const { error: resetError } = await supabase.from('tasks').update({
        status: 'queued',
        error_message: `处理中断：${String(e).slice(0, 200)}`
      }).eq('id', taskId)
      if (resetError) {
        console.error(`[task ${taskId}] 重置回 queued 时写库失败:`, resetError)
      }
    }
    processed++
  }

  return processed
}

// 自愈：把卡在 generating 超过 3 分钟的任务重置回 queued
async function healStuckTasks(): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  const { error } = await supabase.from('tasks').update({ status: 'queued', error_message: null })
    .eq('status', 'generating')
    .lt('updated_at', cutoff)
  if (error) {
    console.error('[自愈] 重置卡死任务时写库失败:', error)
  }
}

// ---------- 处理单个任务 ----------
async function handleTask(taskId: string): Promise<void> {
  console.log(`[task ${taskId}] 开始处理`)

  // 2. 读取任务（先只读 tasks，避免嵌入查询问题）
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (taskError || !task) {
    console.error(`[task ${taskId}] 读取任务失败:`, taskError)
    await failTask(taskId, `任务读取失败：${taskError?.message ?? '未知'}`)
    return
  }

  const t = task as unknown as TaskRow
  console.log(`[task ${taskId}] 任务读取成功，当前资料：标题=${t.product_title ? '有' : '无'}`)
  const doubaoModel = await resolveDoubaoModel()
  console.log(`[task ${taskId}] 使用豆包模型: ${doubaoModel}`)

  // 2.1 单独读模板内容
  let templateContent: string | null = null
  let templateCompliance = ''
  if (t.template_id) {
    const { data: tpl } = await supabase
      .from('sop_templates')
      .select('content, compliance_redlines')
      .eq('id', t.template_id)
      .single()
    templateContent = tpl?.content ?? null
    templateCompliance = tpl?.compliance_redlines ?? ''
  }

  // 读取本次勾选的子模板（按顺序），支持母模板 + 子模板组合
  const subtemplateIds = Array.isArray(t.subtemplate_ids)
    ? t.subtemplate_ids.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : []
  const subtemplates: Array<{ id: string; name: string; content: string }> = []
  for (const id of subtemplateIds) {
    const { data: sub } = await supabase
      .from('sop_templates')
      .select('id, name, content')
      .eq('id', id)
      .maybeSingle()
    if (sub?.content) subtemplates.push(sub)
  }

  // 3. 如果还没有资料，先尝试抓取
  let productTitle = t.product_title
  let productBrand = t.brand_name
  let productBullets = t.product_bullets
  let productImages = t.product_images

  if (!productTitle && !productBullets) {
    console.log(`[task ${taskId}] 开始抓取亚马逊 ${t.marketplace}/${t.asin}`)
    try {
      const fetched = await fetchAmazonListing(t.asin, t.marketplace)
      productTitle = fetched.title
      productBrand = fetched.brand
      productBullets = fetched.bullets
      productImages = fetched.images
      console.log(`[task ${taskId}] 抓取成功，品牌=${productBrand || '未识别'}，标题长度 ${productTitle.length}，五点 ${productBullets.length} 条，图片 ${productImages.length} 张`)

      await supabase.from('tasks').update({
        product_title: productTitle,
        brand_name: productBrand,
        product_bullets: productBullets,
        product_images: productImages,
        fetch_mode: 'auto'
      }).eq('id', taskId)
    } catch (e) {
      // 抓取失败 → 转人工补充
      await supabase.from('tasks').update({
        status: 'need_input',
        error_message: `自动抓取失败：${String(e).slice(0, 200)}`
      }).eq('id', taskId)
      return
    }
  }

  // 4. 组装 AI 指令（完整商品资料 + 完整生成规则，一次看全，不再重复）
  const imageCount = Math.max(1, subtemplates.length || t.image_count || 1)

  const ctx = {
    title: productTitle ?? '',
    brand_name: productBrand ?? '',
    bullets: productBullets ?? [],
    images: productImages ?? [],
    compliance_redlines: templateCompliance,
    all_selling_points: t.selling_points,
    image_count: imageCount,
    asin: t.asin,
    marketplace: t.marketplace
  }

  // 给管理员看的完整组装预览：母模板 + 所有勾选子模板
  const overviewTemplate = subtemplates.length
    ? `${templateContent ?? ''}\n\n${subtemplates.map((s) => `【${s.name}】\n${s.content}`).join('\n\n')}`
    : templateContent
  const basePrompt = assemblePrompt(overviewTemplate, ctx)

  await supabase.from('tasks').update({ prompt_assembled: basePrompt }).eq('id', taskId)

  // 5. 每次调用只生成下一张，避免多图任务超过函数执行时限
  try {
    const { count: doneCount, error: countError } = await supabase
      .from('task_results')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
    if (countError) throw new Error(`统计已生成图片失败：${countError.message}`)

    const generated = doneCount ?? 0
    console.log(`[task ${taskId}] 已生成 ${generated}/${imageCount} 张`)

    if (generated >= imageCount) {
      console.log(`[task ${taskId}] 图片已全部生成，标记完成`)
      await supabase.from('tasks').update({
        status: 'succeeded',
        completed_at: new Date().toISOString()
      }).eq('id', taskId)
      return
    }

    const index = generated
    console.log(`[task ${taskId}] 生成第 ${index + 1}/${imageCount} 张`)
    const child = subtemplates[index] ?? null
    const promptTemplate = child
      ? `${templateContent ?? ''}\n\n${child.content}`
      : templateContent
    const promptBase = assemblePrompt(promptTemplate, ctx)
    const prompt = `${promptBase}\n\n（本次只生成第 ${index + 1}/${imageCount} 张图，对应图序：${child?.name ?? `图${index + 1}`}，请严格按照上面规则执行）`
    // 由函数自己下载参考图并转为 Base64：
    // 避免豆包侧直接请求 Amazon 图片域名时偶发下载超时。
    const referenceImages = await prepareReferenceImages(productImages, taskId)
    const imageUrl = await callDoubao(prompt, referenceImages, doubaoModel)
    console.log(`[task ${taskId}] 第 ${index + 1} 张豆包返回成功`)
    const savedPath = await saveImageToStorage(imageUrl, taskId)
    await supabase.from('task_results').insert({
      task_id: taskId,
      image_path: savedPath,
      model: doubaoModel
    })

    const nextTotal = generated + 1
    if (nextTotal >= imageCount) {
      console.log(`[task ${taskId}] 全部生成完成，共 ${nextTotal} 张`)
      await supabase.from('tasks').update({
        status: 'succeeded',
        completed_at: new Date().toISOString()
      }).eq('id', taskId)
    } else {
      // 还有剩余图片，回到排队，等待下一次调度继续生成
      await supabase.from('tasks').update({
        status: 'queued',
        retry_count: 0,
        error_message: null
      }).eq('id', taskId)
    }
  } catch (e) {
    console.error(`[task ${taskId}] 豆包生成失败:`, e)
    // 重试 1 次
    const retry = await supabase.from('tasks').select('retry_count').eq('id', taskId).single()
    const count = (retry?.data?.retry_count ?? 0) as number
    if (count < 1) {
      await supabase.from('tasks').update({
        status: 'queued',
        retry_count: count + 1
      }).eq('id', taskId)
    } else {
      await failTask(taskId, `豆包生成失败：${String(e).slice(0, 200)}`)
    }
  }
}

// 模型 ID 优先读取管理员维护的系统设置，环境变量只作为兜底
async function resolveDoubaoModel(): Promise<string> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'default_doubao_model')
    .maybeSingle()

  if (error) {
    console.error('读取 default_doubao_model 失败，使用兜底模型:', error)
    return FALLBACK_DOUBAO_MODEL
  }

  const value = data?.value
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : FALLBACK_DOUBAO_MODEL
}

// 把卖点说明按行拆成数组
function parseSellingPoints(text: string): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------- 组装指令（纯占位符替换，结构完全由模板决定） ----------
function assemblePrompt(
  template: string | null,
  ctx: {
    title: string
    brand_name: string
    bullets: string[]
    images: string[]
    compliance_redlines: string
    all_selling_points: string
    image_count: number
    asin: string
    marketplace: string
  }
): string {
  const imageText = (ctx.images || []).filter(Boolean).join('\n')
  const bulletText = (ctx.bullets || []).length
    ? ctx.bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')
    : ''
  const sellingText = ctx.all_selling_points || ''
  const complianceText = ctx.compliance_redlines || ''

  // 占位符 → 真实数据（模板里出现的 {{xxx}} 会被替换）
  const data: Record<string, string> = {
    '图片数量': String(ctx.image_count),
    '商品图片': imageText,
    '商品标题': ctx.title || '',
    '商品品牌名': ctx.brand_name || '',
    '五点描述': bulletText,
    '所有卖点信息': '',
    '卖点补充': sellingText,
    '违禁词合规红线': complianceText,
    '商品资料': `【商品图片】\n${imageText}\n【商品标题】\n${ctx.title || ''}\n【商品品牌名】\n${ctx.brand_name || ''}\n【五点描述】\n${bulletText}\n【所有卖点信息】\n（由豆包自行提取）\n【卖点补充】\n${sellingText}\n【违禁词合规红线】\n${complianceText}`,
    'ASIN': ctx.asin,
    '站点': ctx.marketplace,
    // 兼容旧占位符
    '标题': ctx.title || '',
    '品牌': ctx.brand_name || '',
    '合规红线': complianceText,
    '五点': bulletText,
    '卖点': sellingText
  }

  if (!template) {
    return `请根据以下商品资料生成营销图：\n\n【商品标题】\n${ctx.title || '（无）'}\n\n【商品品牌名】\n${ctx.brand_name || '（无）'}\n\n【五点描述】\n${bulletText || '（无）'}\n\n【所有卖点信息】\n${sellingText || '（无）'}\n\n【违禁词合规红线】\n${complianceText || '（无）'}`
  }

  const variablePattern = /\{\{(图片数量|商品图片|商品标题|商品品牌名|五点描述|所有卖点信息|卖点补充|违禁词合规红线|商品资料|ASIN|站点|标题|品牌|合规红线|五点|卖点)\}\}/g
  let resolved = template
  // 多轮替换：支持“违禁词合规红线”字段内部再引用商品品牌名等变量。
  for (let pass = 0; pass < 4; pass++) {
    const next = resolved.replace(variablePattern, (_, key: string) => data[key] ?? '')
    if (next === resolved) break
    resolved = next
  }
  return resolved
}
// ---------- 抓取亚马逊资料（自动优先，失败抛错转兜底） ----------
async function fetchAmazonListing(
  asin: string,
  marketplace: string
): Promise<{ title: string; brand: string; bullets: string[]; images: string[] }> {
  const domain = marketplaceToDomain(marketplace)
  // 多候选 URL：PC 主图页 / gp/product / 移动版，任一成功即可
  const urls = [
    `https://www.${domain}/dp/${asin}`,
    `https://www.${domain}/gp/product/${asin}`,
    `https://www.${domain}/gp/aw/d/${asin}`
  ]

  let lastError = ''
  for (const url of urls) {
    try {
      const html = await fetchAmazonHtml(url)
      const parsed = parseAmazonHtml(html)
      if (parsed.title) {
        console.log(`[抓取] 成功 ${url}，品牌=${parsed.brand || '未识别'}，标题 ${parsed.title.length} 字，五点 ${parsed.bullets.length} 条，图片 ${parsed.images.length} 张`)
        return parsed
      }
      lastError = '未解析到商品标题'
      console.log(`[抓取] ${url} 返回 ${html.length} 字节但无标题`)
    } catch (e) {
      lastError = String(e).slice(0, 200)
      console.log(`[抓取] ${url} 失败: ${lastError}`)
    }
  }
  throw new Error(lastError || '亚马逊抓取失败')
}

// 抓取单个 URL 的 HTML（带更完整的浏览器请求头）
async function fetchAmazonHtml(url: string): Promise<string> {
  const resp = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    }
  }, 15000)

  if (!resp.ok) {
    throw new Error(`亚马逊返回 ${resp.status}`)
  }
  const html = await resp.text()

  // 机器人验证页特征
  if (/Robot Check|api-services-support|Type the characters|Enter the characters|captcha|validateCaptcha/i.test(html)) {
    console.log(`[抓取] 疑似机器人验证页，长度 ${html.length}`)
    throw new Error('亚马逊反爬拦截（机器人验证页）')
  }
  return html
}

// 从 HTML 解析品牌 / 标题 / 五点 / 图片
function parseAmazonHtml(html: string): { title: string; brand: string; bullets: string[]; images: string[] } {
  // 标题：优先 #productTitle
  let title = ''
  const titleMatch = html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/)
  if (titleMatch) {
    title = titleMatch[1].trim()
  }
  // 兜底：og:title 或 <title>
  if (!title) {
    const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
      || html.match(/<title>([\s\S]*?)<\/title>/i)
    if (og) {
      title = og[1].replace(/<[^>]+>/g, '').replace(/^Amazon(\.com|\.co\.uk|\.de|\.co\.jp|\.ca|\.fr|\.it|\.es|\.com\.au)?\s*:\s*/i, '').trim()
    }
  }

  // 品牌：常见于 bylineInfo、po-brand 或页面 JSON
  let brand = ''
  const brandPatterns = [
    /<a[^>]*id="bylineInfo"[^>]*>([\s\S]*?)<\/a>/i,
    /<[^>]+id="brand"[^>]*>([\s\S]*?)<\/[^>]+>/i,
    /id="brand"[\s\S]{0,600}?<span[^>]*>([\s\S]*?)<\/span>/i,
    /po-brand[\s\S]{0,1200}?po-break-word[^>]*>([\s\S]*?)<\/span>/i,
    /"brand"\s*:\s*"([^"]+)"/i
  ]
  for (const pattern of brandPatterns) {
    const match = html.match(pattern)
    const cleaned = cleanBrandText(match?.[1] ?? '')
    if (cleaned) {
      brand = cleaned
      break
    }
  }

  // 五点
  const bullets: string[] = []
  const bulletsMatch = html.match(/id="feature-bullets"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/)
  if (bulletsMatch) {
    for (const m of bulletsMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      bullets.push(m[1].replace(/<[^>]+>/g, '').trim())
    }
  }

  // 图片
  const images: string[] = []
  for (const m of html.matchAll(/data-old-hires="([^"]+\.jpg)"/g)) {
    if (!images.includes(m[1])) images.push(m[1])
  }
  if (!images.length) {
    for (const m of html.matchAll(/<img[^>]+src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+\.jpg)"/g)) {
      if (!images.includes(m[1]) && images.length < 7) images.push(m[1])
    }
  }

  return { title, brand, bullets: bullets.slice(0, 5), images: images.slice(0, 7) }
}

function cleanBrandText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Visit the\s+/i, '')
    .replace(/\s+Store$/i, '')
    .replace(/^Brand\s*:\s*/i, '')
    .trim()
}
function marketplaceToDomain(marketplace: string): string {
  const map: Record<string, string> = {
    US: 'amazon.com',
    UK: 'amazon.co.uk',
    DE: 'amazon.de',
    JP: 'amazon.co.jp',
    CA: 'amazon.ca',
    FR: 'amazon.fr',
    IT: 'amazon.it',
    ES: 'amazon.es',
    AU: 'amazon.com.au',
    AE: 'amazon.ae',
    SA: 'amazon.sa'
  }
  return map[marketplace] ?? 'amazon.com'
}

// ---------- 调用豆包 API ----------
async function callDoubao(
  prompt: string,
  referenceImages: string[] | null,
  model: string
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    response_format: 'url',
    watermark: false
  }
  if (referenceImages && referenceImages.length) {
    body.image = referenceImages.slice(0, 3)
  }

  const resp = await fetchWithTimeout(`${ARK_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ARK_API_KEY}`
    },
    body: JSON.stringify(body)
  }, 90000) // 豆包 5.5 生成耗时波动较大；90 秒仍低于函数 150 秒总上限

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`豆包 API ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const json = await resp.json()
  const url = json?.data?.[0]?.url
  if (!url) {
    throw new Error('豆包 API 未返回图片链接')
  }
  return url
}

// 下载亚马逊参考图并转为 data URL，限制数量与体积，避免请求体过大
async function prepareReferenceImages(
  urls: string[] | null,
  taskId: string
): Promise<string[]> {
  const candidates = (urls ?? []).filter(Boolean).slice(0, 3)
  const prepared: string[] = []
  let totalBytes = 0
  const maxImageBytes = 4 * 1024 * 1024
  const maxTotalBytes = 8 * 1024 * 1024

  const results = await Promise.allSettled(
    candidates.map(async (url) => {
      const resp = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': 'https://www.amazon.com/'
        }
      }, 15000)
      if (!resp.ok) throw new Error(`参考图返回 ${resp.status}`)

      const buf = await resp.arrayBuffer()
      if (buf.byteLength > maxImageBytes) {
        throw new Error(`参考图超过 ${Math.round(maxImageBytes / 1024 / 1024)}MB`)
      }
      const contentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0]
      if (!contentType.startsWith('image/')) throw new Error('参考图类型无效')
      return {
        bytes: buf.byteLength,
        dataUrl: `data:${contentType};base64,${bytesToBase64(new Uint8Array(buf))}`
      }
    })
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`[task ${taskId}] 跳过一张参考图:`, result.reason)
      continue
    }
    if (totalBytes + result.value.bytes > maxTotalBytes) {
      console.warn(`[task ${taskId}] 参考图总大小将超过限制，停止追加`)
      break
    }
    totalBytes += result.value.bytes
    prepared.push(result.value.dataUrl)
  }

  if (candidates.length > 0 && prepared.length === 0) {
    throw new Error('商品参考图全部下载失败，请检查图片地址后重做任务')
  }
  console.log(
    `[task ${taskId}] 参考图准备完成：${prepared.length}/${candidates.length} 张，` +
    `约 ${(totalBytes / 1024 / 1024).toFixed(2)}MB`
  )
  return prepared
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// 带超时的 fetch，防止网络请求无限挂起
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs}ms）`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 图片转存到 storage（豆包 URL 24h 失效，需转存） ----------
async function saveImageToStorage(imageUrl: string, taskId: string): Promise<string> {
  const resp = await fetch(imageUrl)
  if (!resp.ok) throw new Error('下载豆包图片失败')
  const buf = await resp.arrayBuffer()

  const path = `results/${taskId}/${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from('task-results').upload(path, buf, {
    contentType: 'image/png',
    upsert: false
  })
  if (error) throw new Error(`保存图片失败：${error.message}`)

  // 返回可访问的公开 URL
  const { data: urlData } = supabase.storage.from('task-results').getPublicUrl(path)
  return urlData.publicUrl
}

// ---------- 标记失败 ----------
async function failTask(taskId: string, message: string): Promise<void> {
  const { error } = await supabase.from('tasks').update({
    status: 'failed',
    error_message: message
  }).eq('id', taskId)
  if (error) {
    console.error(`[task ${taskId}] 标记失败时写库也失败（可能仍缺权限）:`, error)
  }
}
