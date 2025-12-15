# Lark / Feishu Dashboard Map Widget

Leaflet 地图组件，读取飞书多维表格（名称字段 + 单列经纬度字段）并在仪表盘上打点。


## 飞书仪表盘内接入

在仪表盘添加「组件 / 插件」，配置 iframe 指向 Vercel 部署地址。  


## 部署

- 推荐一键部署到 Vercel，保持默认 `next.config.ts`。  
- 无需服务器端渲染；此页面为纯前端，依赖飞书 iframe 提供的多维表 JS SDK。
