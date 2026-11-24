# AI 图片工场

公司内部使用的在线工具：运营输入 ASIN + 站点 + 卖点，系统自动抓取亚马逊商品资料，
调用豆包 Seedream 生成带卖点的营销图，排队出图、自动归档，支持多图。

## 技术栈

- Vue 3 + TypeScript（strict）+ Vite 7
- Element Plus + vxe-table
- Pinia + persistedstate
- Supabase（数据库 / 登录 / 存储 / Edge Functions）
- Hash 路由 + GitHub Pages 部署

## 本地开发

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 部署

推送到 GitHub 仓库的 `main` 分支后，`.github/workflows/deploy-pages.yml`
会自动构建并发布到 GitHub Pages（需在仓库 Settings → Pages 中将
Source 设为 GitHub Actions）。
