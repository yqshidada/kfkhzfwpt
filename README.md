# 康复科患者服务平台

基于 uni-app（Vue 2）的 H5 患者服务平台，配套 Node.js、Express 与 MySQL/MariaDB 后端。

## 功能

- 患者信息登记、出院指导与 PDF 报告生成。
- 出院流程登记、二维码分享和报告图片阅读。
- 免登录床位预约，支持预约医生、管道多选和特殊需求。
- 预约验证码、身份证及手机号校验、预约中记录防重复。
- 护士端患者与预约列表、状态筛选、确认、取消、再次预约及删除。
- 预约前一天护士站内提醒。

## 本地运行

1. 使用 HBuilderX 打开项目，准备 MySQL/MariaDB。
2. 在 server 目录安装依赖：`npm ci`。
3. 复制 server/.env.example 为 server/.env，填写本机数据库配置、独立的 JWT_SECRET 与 RESERVATION_ID_KEY。正式环境必须设置独立登录密码和密钥。
4. 在 server 目录执行 `npm run dev` 启动后端。
5. 在 HBuilderX 中选择“运行 → 运行到浏览器”。页面默认端口 8081，后端默认端口 3000。

当前电脑也可使用 scripts/start-local.ps1 启动已有本地环境；详细说明见 [LOCAL_H5.md](LOCAL_H5.md)。PDF 图片阅读需安装 Poppler，配置说明见 [server/README.md](server/README.md)。

## 目录

| 目录 | 内容 |
| --- | --- |
| pages、components、utils、static | 页面、组件、接口和静态资源 |
| server | 后端源码、依赖清单、环境示例和测试 |
| server/documents | 固定入院流程文档 |
| scripts | 本地启动、页面检查和文档构建脚本 |
| deploy | 部署、备份、迁移与线上核验脚本 |

## 开发说明

- [床位预约说明](BED_RESERVATIONS.md)
- [出院流程说明](DISCHARGE_FLOW.md)
- [项目开发记录](CODEX_PROJECT_CONTEXT.md)
- [Linux 部署说明](deploy/LINUX.md)

## 文件管理

仓库保存项目源码、依赖清单和必要文档。数据库、患者报告、账号密码、私钥、部署备份、临时截图、依赖目录及编译产物均不提交。server/.env.example 仅为配置模板，真实配置保存在未纳入版本管理的 server/.env 中。

## 同事协作与发布同步

团队以 `https://github.com/yqshidada/kfkhzfwpt.git` 的 `main` 分支为代码基准。请克隆仓库，在各自的工作副本中开发；开始修改前先同步远端，提交前检查同事的新更新并处理冲突，不强制覆盖历史。详细约定见 [AGENTS.md](AGENTS.md)。

每次正式发布都要记录实际构建的源码提交号。服务器发布和核验成功后，将相应源码与发布记录同步到 GitHub，并核对远端提交。服务器发布与 GitHub 同步两项均完成，才视为本次发布完成；GitHub 上存在但尚未部署的后续修改应单独注明。

首次克隆仍需按上文安装依赖、准备数据库并填写自己的环境配置。不要从同事电脑复制真实患者数据或将私有环境文件加入版本管理。
