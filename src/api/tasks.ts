import { requireSupabase } from '@/api/supabase'

export interface TaskRow {
  id: string
  asin: string
  marketplace: string
  selling_points: string
  template_id: string | null
  prompt_assembled: string | null
  fetch_mode: 'auto' | 'manual' | null
  product_title: string | null
  brand_name: string | null
  product_bullets: string[] | null
  product_images: string[] | null
  subtemplate_ids: string[] | null
  status: string
  error_message: string | null
  retry_count: number
  image_count: number
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
  /** 关联查询得到的模板名与提交人姓名 */
  template_name?: string
  creator_name?: string
}

export interface TaskListQuery {
  page: number
  pageSize: number
  asins?: string[]
  status?: string
  marketplace?: string
  from?: string
  to?: string
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}

export interface TaskListResult {
  rows: TaskRow[]
  total: number
}

/** 任务列表：服务端分页 + 筛选 + 排序 + 关联模板名/提交人（查视图 task_view） */
export async function fetchTasks(query: TaskListQuery): Promise<TaskListResult> {
  const supabase = requireSupabase()
  const from = (query.page - 1) * query.pageSize
  const to = from + query.pageSize - 1

  let builder = supabase
    .from('task_view')
    .select('*', { count: 'exact' })
    .range(from, to)

  if (query.asins?.length) builder = builder.in('asin', query.asins)
  if (query.status) builder = builder.eq('status', query.status)
  if (query.marketplace) builder = builder.eq('marketplace', query.marketplace)
  if (query.from) builder = builder.gte('created_at', query.from)
  if (query.to) builder = builder.lte('created_at', query.to)

  const sortField = query.sortField || 'created_at'
  const sortOrder = query.sortOrder || 'desc'
  builder = builder.order(sortField, { ascending: sortOrder === 'asc' })

  const { data, error, count } = await builder
  if (error) throw new Error(error.message)

  return { rows: (data ?? []) as TaskRow[], total: count ?? 0 }
}

export interface CreateTaskInput {
  asin: string
  marketplace: string
  selling_points: string
  template_id: string | null
  subtemplate_ids?: string[]
}

/** 新建任务：初始状态 pending_fetch，提交人自动取当前登录用户；image_count 由模板决定 */
export async function createTask(input: CreateTaskInput): Promise<string> {
  const supabase = requireSupabase()

  // 先取模板的 image_count
  let imageCount = 1
  if (input.subtemplate_ids?.length) {
    imageCount = input.subtemplate_ids.length
  } else if (input.template_id) {
    const { data: tpl } = await supabase
      .from('sop_templates')
      .select('image_count')
      .eq('id', input.template_id)
      .single()
    imageCount = tpl?.image_count ?? 1
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      asin: input.asin.trim(),
      marketplace: input.marketplace,
      selling_points: input.selling_points.trim(),
      template_id: input.template_id,
      image_count: imageCount,
      subtemplate_ids: input.subtemplate_ids ?? [],
      status: 'pending_fetch',
      fetch_mode: 'auto'
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  // 提交后立即触发一次任务处理器（让任务尽快进入队列处理）
  void supabase.functions.invoke('process-task').catch(() => {
    // 触发失败不影响任务创建（cron 定时任务也会兜底处理）
  })

  return data.id
}

/** 任务详情（查视图拿模板名/提交人，另查结果图片列表） */
export async function fetchTaskDetail(id: string): Promise<TaskRow & { results: Array<{ id: string; image_path: string; model: string | null }> }> {
  const supabase = requireSupabase()

  const { data, error } = await supabase
    .from('task_view')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)

  const { data: results, error: resError } = await supabase
    .from('task_results')
    .select('id, image_path, model')
    .eq('task_id', id)
    .order('created_at', { ascending: true })
  if (resError) throw new Error(resError.message)

  return {
    ...(data as unknown as TaskRow),
    results: (results ?? []) as Array<{ id: string; image_path: string; model: string | null }>
  }
}

/** 删除任务（本人或管理员） */
export async function deleteTask(id: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** 待补充状态：补填商品资料 */
export async function supplementTask(
  id: string,
  data: {
    product_title: string
    brand_name: string
    product_bullets: string[]
    product_images: string[]
  }
): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('tasks')
    .update({
      product_title: data.product_title,
      brand_name: data.brand_name,
      product_bullets: data.product_bullets,
      product_images: data.product_images,
      fetch_mode: 'manual'
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** 编辑商品资料（等待输出前、失败/成功后重新生成前均可） */
export async function updateTaskProductData(
  id: string,
  data: {
    product_title: string
    brand_name: string
    product_bullets: string[]
    product_images: string[]
  }
): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('tasks')
    .update({
      product_title: data.product_title,
      brand_name: data.brand_name,
      product_bullets: data.product_bullets,
      product_images: data.product_images,
      fetch_mode: 'manual'
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** 重做任务：重置为排队/待抓取，并触发一次处理器 */
export async function retryTask(id: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase.rpc('retry_task', { p_task_id: id })
  if (error) throw new Error(error.message)
  void supabase.functions.invoke('process-task').catch(() => {
    // 触发失败不影响任务状态（cron 也会兜底）
  })
}

/** 结果图存在私有桶，前端展示需要临时签名地址 */
async function resolveStoredImageUrl(stored: string): Promise<string> {
  const supabase = requireSupabase()
  const marker = '/object/public/task-results/'
  let path = stored
  if (stored.includes(marker)) {
    path = stored.slice(stored.indexOf(marker) + marker.length)
  } else if (stored.startsWith('results/')) {
    path = stored
  } else if (stored.includes('/object/sign/')) {
    return stored
  } else if (stored.startsWith('http')) {
    return stored
  }

  const { data, error } = await supabase.storage.from('task-results').createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return stored
  return data.signedUrl
}

export async function resolveTaskResultUrls(imagePaths: string[]): Promise<string[]> {
  return Promise.all(imagePaths.map((path) => resolveStoredImageUrl(path)))
}

/** 上传本地参考图到员工个人目录，并返回 7 天有效的签名地址 */
export async function uploadReferenceImage(file: File): Promise<string> {
  const supabase = requireSupabase()
  const { data: session } = await supabase.auth.getSession()
  const userId = session.session?.user.id
  if (!userId) throw new Error('登录状态已失效，请重新登录')

  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${userId}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage.from('task-references').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false
  })
  if (error) throw new Error(`上传图片失败：${error.message}`)

  const { data, error: signError } = await supabase.storage
    .from('task-references')
    .createSignedUrl(path, 60 * 60 * 24 * 7)
  if (signError || !data?.signedUrl) throw new Error('生成图片地址失败')
  return data.signedUrl
}
