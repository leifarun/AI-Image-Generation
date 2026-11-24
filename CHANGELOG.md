# 更新记录（CHANGELOG）

本项目所有重要变更记录于此文件，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本（SemVer）。

发布流程：更新 `package.json` 版本号 → 本文件新增条目 → 打 Git 标签（如 `v0.1.0`）→ 推送标签并在 GitHub 创建 Release。

## [Unreleased]

## [0.1.0] - 2026-11-24

首个正式上线版本。

### 新增

- 前端正式部署到 GitHub Pages：<https://leifarun.github.io/AI-Image-Generation/>，推送 `main` 自动构建发布。
- 通过 ASIN 自动抓取亚马逊商品资料（多 URL 兜底，移动版端点优先）。
- 按 SOP 模板（母模板 + 子模板）组装指令，调用豆包 Seedream 生成多张卖点营销图。
- 任务列表 / 新建 / 详情：状态、失败原因、组装指令（管理员）、商品资料编辑与本地图上传。
- 多图逐张生成、排队调度（pg_net + cron）、失败重做、结果预览与批量 ZIP 下载。
- 员工账号管理（创建 / 编辑 / 停用 / 角色 / 重置密码），使用登录 ID 登录。
- 系统设置：模型选择（Seedream 5.5 / 5.0 Pro / Flash / Lite / 4.5 / 4.0）与默认模型。
- 新建任务显示预计调用成本。

### 支持站点

- US / UK / DE / JP / CA / FR / IT / ES / AU / AE / SA
