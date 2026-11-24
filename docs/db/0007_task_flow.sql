-- ============================================================
-- 0007：任务状态流转触发器
-- 1. 新建任务后，若已有资料则直接排队；否则保持待抓取（由处理器抓取）
-- 2. 运营补充资料后（need_input → 有资料），自动重新排队
-- ============================================================

-- 新建任务后自动进入待抓取队列（处理器会来领取）
-- 实际上：任务插入时 status 已默认 pending_fetch，处理器应同时领取 pending_fetch 和 queued。
-- 为简化，这里把 claim_next_task 扩展为同时领取 pending_fetch 和 queued。

create or replace function public.claim_next_task()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_concurrent integer := 2;
  v_task_id uuid;
  v_running integer;
begin
  select (value #>> '{}')::integer into v_max_concurrent
  from public.system_settings
  where key = 'max_concurrent_tasks'
  limit 1;

  select count(*) into v_running
  from public.tasks
  where status = 'generating';

  if v_running >= v_max_concurrent then
    return null;
  end if;

  -- 领取：优先排队中的（已抓取），其次待抓取的
  select id into v_task_id
  from public.tasks
  where status in ('queued', 'pending_fetch')
  order by (status = 'queued') desc, created_at asc
  limit 1
  for update skip locked;

  if v_task_id is null then
    return null;
  end if;

  update public.tasks
  set status = 'generating'
  where id = v_task_id;

  return v_task_id;
end;
$$;

grant execute on function public.claim_next_task() to service_role;
grant execute on function public.claim_next_task() to authenticated;

-- 运营补充资料后，任务从 need_input 自动回到 queued（等待处理器）
create or replace function public.on_task_supplemented()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 当任务被补充了资料（标题或五点非空）且当前是 need_input，则重新排队
  if (new.product_title is not null and new.product_title <> '')
     or (new.product_bullets is not null and jsonb_array_length(new.product_bullets) > 0) then
    if old.status = 'need_input' and new.status = 'need_input' then
      new.status := 'queued';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_supplemented on public.tasks;
create trigger trg_task_supplemented
  before update on public.tasks
  for each row execute function public.on_task_supplemented();
