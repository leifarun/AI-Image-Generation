import { requireSupabase } from '@/api/supabase'

export interface SopTemplateRow {
  id: string
  name: string
  content: string
  compliance_redlines: string
  is_default: boolean
  is_active: boolean
  image_count: number
  parent_id: string | null
  sort_order: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface SopTemplateInput {
  name: string
  content: string
  compliance_redlines: string
  is_default: boolean
  is_active: boolean
  image_count: number
  parent_id?: string | null
  sort_order?: number
}

/** 拉取启用的模板（新建任务下拉用，运营也能读） */
export async function fetchActiveTemplates(): Promise<SopTemplateRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('sop_templates')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as SopTemplateRow[]
}

/** 拉取全部模板（管理员管理页用） */
export async function fetchAllTemplates(): Promise<SopTemplateRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('sop_templates')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as SopTemplateRow[]
}

export async function createTemplate(input: SopTemplateInput): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('sop_templates')
    .insert({
      ...input,
      parent_id: input.parent_id ?? null,
      sort_order: input.sort_order ?? 0
    })
  if (error) throw new Error(error.message)
}

export async function updateTemplate(id: string, input: SopTemplateInput): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('sop_templates')
    .update({
      ...input,
      parent_id: input.parent_id ?? null,
      sort_order: input.sort_order ?? 0
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteTemplate(id: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase.from('sop_templates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
