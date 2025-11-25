# Lark / Feishu Dashboard Map Widget

Leaflet 地图组件，读取飞书多维表格（名称字段 + 单列经纬度字段）并在仪表盘上打点。

## 开发

```bash
npm install
npm run dev
```

访问 `http://localhost:3000` 预览。未在飞书环境时会使用示例数据。

## 飞书仪表盘内接入

1) 在仪表盘添加「组件 / 插件」，配置 iframe 指向 Vercel 部署地址。  
2) 确保页面在 iframe 内可以访问 `@lark-base-open/js-sdk`（飞书内置）。  
3) 进入仪表盘后，选择「多维表、名称字段、经纬度字段」，点击「从多维表加载」即可打点。经纬度示例：`31.23,121.48` 或含 `latitude/longitude` 的位置对象。

## 部署

- 推荐一键部署到 Vercel，保持默认 `next.config.ts`。  
- 无需服务器端渲染；此页面为纯前端，依赖飞书 iframe 提供的多维表 JS SDK。
