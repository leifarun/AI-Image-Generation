# AGENTS.md — AI 图片工场

## 同步与发布规则（强制）

1. 任何修改都要同时同步到「本地 + GitHub」：改完先跑 `npm run typecheck` 和 `npm run build`，两者通过后再 `git commit`，然后 `git push origin main`。
2. 每次发布都要有版本发布记录：
   - 更新 `package.json` 的 `version`；
   - 在 `CHANGELOG.md` 新增对应版本条目（版本号 + 日期 + 变更清单）；
   - 打注释标签（如 `v0.1.0`）并推送标签（`git push origin <tag>`）；
   - 在 GitHub Releases 创建同版本发布。
3. 不要只改本地不推送，也不要只推送不记录版本。

## 技术约束

- Vite 7（不是 8），Vue 3 + TypeScript strict，Element Plus + vxe-table 4.x，Pinia，Supabase，Hash 路由。
- 前端只允许放 Supabase Publishable(anon) 公开键；`service_role`、豆包 `ARK_API_KEY` 只放 Supabase Secrets，禁止入前端。
- `.env` 不入库；生产公开键放 `.env.production`。
- 多图任务必须逐张生成、单次 Edge Function 只做一张，避免超过 150 秒上限。

## 部署信息

- GitHub 仓库：<https://github.com/leifarun/AI-Image-Generation>
- 线上地址：<https://leifarun.github.io/AI-Image-Generation/>
- 自动部署：`.github/workflows/deploy-pages.yml`（推送 `main` 触发，自动注入 `VITE_BASE_PATH`）。
