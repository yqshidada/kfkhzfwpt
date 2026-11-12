# 入院流程

首页“入院流程”进入 `pages/rylc/index.vue`，先按顺序展示完整的 12 个入院步骤和说明，最下方保留固定入院流程二维码卡片。页面内容与 PDF 生成脚本共用 `server/documents/admission-flow.json`，二维码加载或重试时流程正文仍可阅读。工作人员查看该页面需要登录，患者扫码进入 `/documents/admission-flow` 无需登录，可预览、打开或下载 PDF。

固定文件为 `server/documents/admission-flow.pdf`，不写入患者表、不生成患者分享令牌、不设置过期时间。清除患者记录及 `storage/reports` 不会影响此文件。二维码链接沿用后端 `SHARE_BASE_URL`，未配置时使用当前请求的协议和主机。

内容根据用户提供的“康复科入院流程”图片整理，维护在 `server/documents/admission-flow.json`。如需修改内容，在安装有 reportlab 的 Python 环境执行 `python scripts/build-admission-pdf.py`，可通过 `--font` 指定可嵌入的中文 TrueType 字体路径。字体嵌入 PDF，服务器运行时不需要 Python 或字体。

本地测试请重启后端并重新运行 H5。如果用手机扫码，手机需能访问本机服务：使用同一局域网，在本机 `SHARE_BASE_URL` 配置实际可访问的局域网地址（包含端口），不要使用手机无法访问的 localhost。本次未改动 `.env`，未发布服务器。

后续发布需更新 H5 构建产物、`server/index.js`，并上传 `server/documents/admission-flow.pdf`；已有出院流程依赖的 `server/discharge-flow.js` 也需保留。公开路由 `/documents/admission-flow` 和 `/documents/admission-flow/pdf` 需转发至 Node 服务。不要只上传 H5 文件。部署后验证未登录可访问公开 PDF，二维码接口仍要求 token。

运行 `node server/tests/discharge-flow.cjs` 可在独立本地测试库验证入院 PDF 访问、鉴权、缺失文件处理及原出院流程回归。
