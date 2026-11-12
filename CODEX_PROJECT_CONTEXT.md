# 康复科出院指导项目：Codex 开发交接文档

> 生成日期：2026-10-29（Asia/Shanghai）  
> 用途：将本项目的需求、实现状态、部署信息和后续维护要点导入其他 Codex 会话。  
> 安全说明：本文档不包含数据库密码、JWT 密钥、用户密码、二维码 token 或 SSH 私钥内容。

> **最新状态：2026-11-12 09:43（北京时间）预约排队登记顶部提示、提交前确认及成功页说明已正式上线，备份与线上核验通过；预约删除权限修复保留，详见文末。**

## 1. 项目概况

这是一个基于 uni-app Vue 2 的 H5 项目，面向康复科患者出院管理，包含：

- 首页与入院流程入口
- 患者基本信息／出院报告填写
- 出院流程填写
- PDF 出院报告、出院流程和固定入院流程
- 二维码分享
- 手机端图片阅读
- 登录、JWT 鉴权
- 护士端患者列表、搜索、滚动加载和详情
- Node.js + Express + MySQL/MariaDB 后端
- Ubuntu + Caddy + systemd 线上部署

当前线上地址：

- https://gzitwmkfk.cn

当前线上服务器：

- Ubuntu，腾讯云广州地域
- 公网 IP：134.175.42.162
- SSH 用户：ubuntu
- 后端只监听 127.0.0.1:3000
- Caddy 对外提供 80/443
- MariaDB 只监听本机 127.0.0.1:3306

## 2. 历史发布状态（2026-10-26，最新见文末及顶部提示）

最近一次线上发布已经完成：

- 二维码目标改成图片阅读页
- 入院流程、患者报告、出院流程均按页显示 JPEG 图片
- 支持点击放大、适应屏幕、长按保存
- 继续保留 PDF 下载
- 图片首次访问时转换，后续复用缓存
- 过期、撤销或不存在的分享不能继续读取图片
- 修复了 Linux 转图时 PDF 文字前出现方框的问题
- H5 已重新构建并发布
- 已安装 Poppler 和中文字体：
  - poppler-utils
  - poppler-data
  - fonts-noto-cjk

根据用户最新要求，线上数据已经清理：

- 患者记录：0
- 报告分享：0
- 出院流程：0
- 住院号登记：0
- 生成的患者 PDF：已删除
- 图片缓存：已删除
- 固定入院流程文档：保留
- 用户账号：保留 3 个，密码未修改

清理前已经备份：

- 程序回退备份：/root/rehab-code-release-20261026-094951/application.tar.gz
- 清理审计：/root/rehab-patient-reset-20261026-095133
- 清理前业务备份：/var/backups/rehab/rehab-20261026-095134.tar.gz

清理后已验证：

- 原有账号仍可登录
- 患者列表为空
- 域名 HTTPS 正常
- 入院流程图片阅读正常
- 图片放大和 PDF 下载正常
- 线上服务和每日备份定时器均为 active

## 3. 前端页面

主要页面：

| 页面 | 路径 | 用途 |
|---|---|---|
| 首页 | pages/index/index.vue | 首页入口、患者入口、护士入口、入院流程、出院流程 |
| 登录 | pages/login/index.vue | 手机号登录和密码校验 |
| 患者信息 | pages/hzjbxx/index.vue | 填写患者资料并生成出院报告 |
| 出院流程 | pages/cylc/index.vue | 填写结算方式、西药、中药带药 |
| 入院流程 | pages/rylc/index.vue | 展示固定入院流程内容和二维码 |
| 护士列表 | pages/nurse/list.vue | 当前账号的患者记录、搜索、滚动加载 |
| 患者详情 | pages/nurse/detail.vue | 查看患者基本信息、报告二维码、出院流程二维码 |

H5 生产构建目录：

- unpackage/dist/build/web

H5 接口地址：

- H5 使用相对地址 /api
- 具体逻辑在 utils/api.js

非 H5 调试时，utils/api.js 中的 API_BASE_URL 可以改为本机局域网地址，例如：

- http://192.168.x.x:3000/api

## 4. 患者信息表单

患者信息页曾经过多次需求调整，最终包含：

- 姓名
- 性别
- 年龄
  - 选项为 20-30、30-40，直到 80-90／90 岁范围
- 联系电话
  - 手机号格式校验
- 住院号
  - 服务端全局不能重复
- 诊断
  - 下拉选择
  - 脑卒中
  - 肌萎缩侧索硬化症 ALS
  - 脊髓损伤
  - 腰痹
  - 骨折术后
- 出院带药
  - 有／无
  - 选择有后显示药物类型多选
- 管道信息
  - 有／无
  - 选择有后显示管道类型多选
  - 管道类型必须至少选择一项
- 皮肤情况
  - 当前为多选指导模块
  - 皮肤护理和营养支持已拆分为独立选项
  - 相关指导只在 PDF 中生成，不在页面长篇展示
- 复诊须知
  - 只生成到 PDF，不在填写页展示
- 病例复印
  - 只生成到 PDF，不在填写页展示
  - PDF 中包含二维码图片

生成出院报告前有确认提醒。生成成功后直接跳转患者详情页。

同一住院号重复生成时，前端和后端均会拦截。

## 5. 出院带药内容

药物类型数据和说明维护在前端数据文件中，当前支持：

- 降压药
- 降糖药
- 抗癫痫药
- 抗凝药
- 抗心律失常药
- 胰岛素笔

每种药物有对应使用注意事项。多个药物同时勾选时：

- 每种药物的注意事项均写入 PDF
- 总提醒只展示一次
- 总提醒后有药物提示文字
- 线上阅读页只显示生成后的图片，不在页面直接展示长篇说明

## 6. 管道内容

管道模块采用和药物模块一致的结构化方式。

曾支持的管道护理内容包括：

- 胃管护理
- 留置尿管护理
- 腹腔引流管护理
- 造瘘管护理
- 管道通用应急提醒

具体文字由前端数据文件维护，选择的管道类型对应内容写入 PDF。

页面填写时：

- 选择“有无管道”为“无”，不展示管道类型
- 选择“有”，管道类型必填
- 管道护理长篇内容不在页面显示
- 只在生成的 PDF 中显示
- PDF 中有“管道使用注意事项”子标题和总提醒

## 7. 皮肤指导内容

皮肤模块最终拆分为可多选的指导主题：

- 压疮的预防（体位管理与减压）
- 皮肤护理
- 营养支持
- 辅助器具使用与日常活动
- 压疮创面居家护理
- 其他伤口的居家宣教

要求：

- 皮肤情况必填
- 选择的主题只写入 PDF
- “注意事项”和“总提醒”按最终文案生成
- 相关长文不在页面直接展开
- PDF 图片转换后，图片下方保留间距

## 8. 出院流程

页面：

- pages/cylc/index.vue

填写项：

### 步骤一：结算方式

- 柜台身份证医保卡
- 自助机结算
- 短信通知

选择柜台身份证医保卡或自助机结算时，PDF 额外显示：

- （柜台和自助机结算在护士站往右走20米窗口）

### 步骤二：领取西药

西药带药：

- 有
- 无

选“有”时显示：

- 护士站往左走20米的玻璃窗口领取西药

并显示红色小字号：

- 注意：必须有结算的清单发票

如果西药为“无”，该步骤不生成。

### 后续中药步骤

中药带药：

- 有
- 无

选“有”时显示：

- 请前往护士站领取中药

同样显示红色小字号结算提醒。

如果西药为“无”，中药会顺延为步骤二；如果中药为“无”，不生成领取中药步骤。

最后生成资料领取步骤：

- 步骤 X：领取资料

内容：

- 护士站领取出院小结及诊断证明书

如果西药和中药均为“无”，仍生成结算方式和最后领取资料步骤。

出院流程不能重复生成。重复操作返回：

- 已生成出院流程，请前往患者详情页查看

出院流程生成成功后直接跳转患者详情页。

## 9. PDF 生成

患者报告和出院流程 PDF 主要由：

- pages/hzjbxx/report-pdf.js

生成方式：

- 前端生成 Base64 PDF
- 发送到后端保存
- 后端将 PDF 保存到 server/storage/reports
- 报告和流程分享表保存 token、文件路径、过期时间和撤销状态

PDF 关键规则：

- 第一页有标题，后续页面不重复标题
- 页面底部显示页码
- 字段值紧跟中文冒号
- 子标题和正文按最终要求缩进
- 长文本自动分页
- 图片有上下间距
- 中文使用 UniGB-UCS2-H / STSong-Light 兼容方式
- 已移除多余 BOM，避免 Ubuntu 转 JPEG 时出现方框

固定入院流程：

- server/documents/admission-flow.pdf
- server/documents/admission-flow.json

入院流程 PDF 是固定内容，二维码无需登录即可访问。

## 10. 二维码图片阅读

新增后端文件：

- server/report-images.js
- server/image-reader.js
- server/image-reader-client.js

工作流程：

1. 扫描二维码进入 HTML 阅读页
2. 阅读页请求 /images
3. 后端检查原 PDF 和分享 token
4. 首次访问时使用 pdfinfo 获取页数
5. 使用 pdftoppm 按页转换 JPEG
6. 图片写入 server/storage/image-cache
7. manifest.json 最后原子写入
8. 前端按页展示图片
9. 点击图片可放大到原图宽度
10. 仍可点击下载 PDF

约束：

- 单份 PDF 最多 80 页
- PDF 最大 16 MB
- 转换任务单队列串行执行
- 最多 20 份任务进入队列
- 页面后续图片使用 lazy loading
- 图片响应 Cache-Control: no-store
- 图片接口每次重新检查分享有效性
- image-cache 不通过 express.static 公开
- 分享过期或撤销后，图片接口返回 404
- PDF 下载仍受同一分享有效性控制

接口形式：

- 入院流程：
  - /documents/admission-flow
  - /documents/admission-flow/images
  - /documents/admission-flow/images/:page
  - /documents/admission-flow/pdf
- 患者报告或出院流程：
  - /share/:token
  - /share/:token/images
  - /share/:token/images/:page
  - /share/:token/pdf

## 11. 后端与数据库

后端主文件：

- server/index.js
- server/discharge-flow.js

依赖：

- Node.js
- Express
- mysql2
- qrcode
- Poppler 外部命令

主要数据表：

- system_users
- discharge_records
- discharge_record_shares
- discharge_record_flows
- hospitalization_number_registry

用户权限：

- 当前登录账号通过 JWT 识别
- 所有业务接口要求 Authorization: Bearer <token>
- 患者列表只返回当前账号创建的数据
- 患者详情只允许当前账号查看
- 分享链接是匿名访问，但 token 必须有效
- 住院号全局唯一
- 当前没有角色权限区分，登录用户均可进入已授权页面

用户登录规则：

- 账号使用手机号
- 账号必须是中国大陆 11 位手机号
- 密码至少 8 位
- 密码必须包含字母和数字
- 密码不要写进项目文档或提交到代码库

## 12. 本地启动

后端：

```powershell
cd D:\Documents\kfkxcx\server
npm install
# 复制 .env.example 为 .env，并填写本地 MySQL/MariaDB 配置
npm run dev
```

H5：

- 使用 HBuilderX 运行或构建 H5
- 生产输出目录为 unpackage/dist/build/web

本地图片阅读依赖：

- Windows 安装 Poppler
- 确保 pdfinfo 和 pdftoppm 在 PATH
- 或在 server/.env 配置：
  - PDFINFO_PATH=
  - PDFTOPPM_PATH=

本地后端默认：

- http://127.0.0.1:3000

## 13. 测试

完整本地隔离测试：

```powershell
node server/tests/discharge-flow.cjs
```

测试覆盖：

- 登录
- 入院流程 PDF 和二维码
- 图片转换
- 多页 JPEG
- 无效页码
- 缓存复用
- 分享撤销
- 分享过期
- 患者报告
- 出院流程 12 种组合
- 重复生成
- 并发生成
- 账号隔离
- PDF 下载

转换失败测试：

```powershell
node server/tests/image-reader-failure.cjs
```

## 14. 线上检查

SSH：

```powershell
ssh -i C:\Users\Lenovo\.ssh\kfkxcx-tencent-deploy ubuntu@134.175.42.162
```

服务器服务：

```bash
sudo systemctl status rehab-web caddy mariadb --no-pager
sudo systemctl status rehab-backup.timer --no-pager
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS --resolve gzitwmkfk.cn:443:127.0.0.1 https://gzitwmkfk.cn/api/health
```

重要目录：

- 应用：/opt/rehab-app/server
- H5 静态文件：/opt/rehab-app/server/public
- 配置：/opt/rehab-app/server/.env
- 患者 PDF：/opt/rehab-app/server/storage/reports
- 图片缓存：/opt/rehab-app/server/storage/image-cache
- 固定文档：/opt/rehab-app/server/documents
- Caddy：/etc/caddy/Caddyfile
- 备份：/var/backups/rehab

发布注意：

- 先备份
- 只发布编译后的 H5 public 和后端发布文件
- 不上传 .env
- 不覆盖线上 storage
- 不运行清库脚本进行普通发布
- 图片阅读版本必须同时发布 report-images.js、image-reader.js、image-reader-client.js
- Ubuntu 必须有 pdfinfo、pdftoppm 和中文字体

代码发布脚本：

- deploy/release-code-only.sh

清理脚本：

- deploy/clear-patient-data.sh
- 只在用户明确要求清空业务数据时使用
- 会先备份，并验证用户数据和站点配置未改变
- 不会删除 system_users、固定入院流程文档或线上配置

## 15. 重要历史需求摘要

以下是开发对话中已经完成的主要需求：

1. 首页、患者信息页、出院流程页和护士页面搭建。
2. 患者姓名、性别、年龄、联系电话等基础信息。
3. 年龄改为区间选择。
4. 诊断下拉选择。
5. 药物过敏字段改为出院带药。
6. 多种药物类型及对应护理说明。
7. 管道有无、管道类型必填和护理说明。
8. 皮肤情况从单一选项发展为多主题多选指导。
9. 复诊日期等字段后来移除，替换为复诊须知。
10. 增加病例复印和二维码图片。
11. 生成 PDF 并保存到手机／后端。
12. PDF 多次优化：分页、缩进、标题、页码、免责声明、提示文字、图片间距。
13. 生成报告后保存到数据库。
14. 护士端搜索、滚动加载、详情查看。
15. 患者详情可查看二维码。
16. 同住院号禁止重复生成。
17. 生成操作增加确认提醒。
18. 出院流程固定步骤和 PDF 规则。
19. 登录流程、手机号账号、密码校验、JWT。
20. 患者记录按当前账号隔离。
21. Windows 服务器迁移到 Ubuntu。
22. 域名 HTTPS 和 Caddy 配置。
23. 服务器部署、数据库迁移、备份和清理。
24. 二维码从直接 PDF 阅读改成图片阅读，同时保留 PDF 下载。

## 16. 后续开发建议

- 如果要继续改 PDF，优先修改 pages/hzjbxx/report-pdf.js，并重新运行本地 PDF 和 Poppler 转图测试。
- 如果只改分享阅读页，修改 server/image-reader.js 或 server/image-reader-client.js。
- 如果改图片转换策略，修改 server/report-images.js，并测试过期、撤销、并发和缓存。
- 如果改出院流程结构，优先修改 pages/cylc/flow-content.js 和 server/discharge-flow.js。
- 如果改患者表单和指导文字，优先查看 pages/hzjbxx/index.vue 及其导入的数据文件。
- 不要把生产 .env、数据库密码、JWT_SECRET、用户密码、分享 token 写入新文件。
- 线上发布前先在本地运行完整测试，再生成 H5 构建。
- 用户未明确要求时不要清理线上患者数据，也不要执行 clear-patient-data.sh。

## 17. 2026-10-29 当前电脑本地 H5 调试环境

- 当前项目目录：D:\project\kfkxcx（交接文档前文中的 D:\Documents\kfkxcx 为旧电脑路径）。
- manifest.json 新增 h5.devServer：仅监听 127.0.0.1，端口 8081，将 /api、/documents、/share 转发至 http://127.0.0.1:3000；生产接口仍使用 /api。
- 使用当前 HBuilderX 自带的 Node.js 与 uni-app Vue 2 编译器运行 H5，支持热更新。8080 已有程序占用，未停止该程序。
- 使用项目原有、签名有效的 MariaDB 11.4.7 安装包提取本地数据库程序，不安装系统服务；数据库仅监听 127.0.0.1:3306。
- 数据库程序：tmp/mariadb-local；本地数据库数据：tmp/mariadb-data。不要随意清空 tmp，否则会丢失本地调试数据。
- 新建的是独立本地数据库，未导入线上账号或患者数据，未操作线上环境。
- server/.env 的 HOST 与分享地址改为本机地址；清除了旧电脑的 Poppler 绝对路径。密码未写入新文档。
- 新增 scripts/start-local.ps1 与 LOCAL_H5.md。先打开 HBuilderX，再执行 powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1；支持 -BackendOnly。
- 已验证 H5 编译、页面 HTTP 访问、直连和代理健康检查、登录、患者列表、入院流程阅读页及 PDF 下载；图片转换失败降级测试通过。
- 尚未完成：当前电脑缺少 Poppler，下载重试失败，因此本地 PDF 转图片阅读暂不可用，尚未运行依赖 Poppler 的完整集成测试。安装后配置 PDFINFO_PATH 与 PDFTOPPM_PATH 并重启后端。
## 18. 2026-10-29 免登录入口与床位预约完整流程

此节补充并更新前文的功能状态：

- 应用启动页已改为首页，首页、入院流程及预约床位免登录；患者入口、护士入口、出院流程和相关详情仍需登录。登录后回到所选功能，保留出院流程选择参数。
- 入院流程二维码接口已允许匿名访问，但患者数据接口仍需鉴权。
- 首页已新增“预约床位”。原先仅填写的预约页面现已接通匿名提交、表单校验和后端保存，默认状态“预约中”。
- 护士页面 pages/nurse/list.vue 为“患者列表 / 预约列表”两标签；患者内容保持不变。预约列表展示姓名、性别、年龄、电话、提交时间、状态；预约成功显示平均约床时长。
- 新详情 pages/nurse/reservation-detail.vue 展示预约信息及诊断；预约中提供确认按钮，确认成功后隐藏，返回列表刷新。
- 平均约床时长按该条预约的首次确认时间减提交时间计算，24小时为1天，显示两位小数；时间由后端生成，显示按北京时间。字段名沿用需求，并非多条预约的统计平均值。
- 新表 bed_reservations、新模块 server/bed-reservations.js 启动自动初始化；匿名只允许提交，登录账号共享预约处理队列。当前仍无独立角色体系。
- 幂等提交、原子确认、公共提交限流已实现；不改变原有患者数据账号隔离。
- 从“出院流程”进入仍仅展示原患者选择界面，不显示预约标签。
- 详情与部署说明见 BED_RESERVATIONS.md。本次未连接或部署线上服务器。
- 已通过预约隔离集成测试、前端行为测试、免登录入口回归测试、图片失败降级测试，以及H5生产构建（输出到tmp/reservation-h5-build）。完整Poppler图片转换测试仍受本机缺少转换工具限制。

## 19. 2026-10-29 预约身份信息与接口加固

- 按用户要求移除预约填写页“返回首页”（包括提交成功区域）和预约详情页“返回预约列表”按钮。
- 预约表单在手机号下新增必填身份证号；详情显示身份证号，旧记录为空时显示“未填写”。预约列表不展示或返回身份证号。
- 手机号改为11位大陆手机号校验；身份证按18位大陆居民身份证结构校验日期和校验码，支持末位小写x归一为X。前后端共用 server/reservation-validation.js，不代表实名核验。
- 身份证通过 server/reservation-identity.js 使用AES-256-GCM加密存储到新增可空列 id_card_encrypted，启动自动迁移旧表，不清理历史数据。
- 新配置 RESERVATION_ID_KEY 为独立64位十六进制随机密钥。本机已配置；线上需另行设置并妥善备份。禁止将值写入文档、提交代码、打包前端；不要随意轮换，以免历史数据无法解密。
- 匿名预约接口改为解析前限流与8KB JSON请求体限制，拒绝压缩请求体，错误不回显身份证等提交内容。
- 保持免登录提交，查看列表、详情、确认仍需登录。尚无验证码/短信核验、持久化分布式限流、独立护士角色；匿名接口并非完全防刷，不能宣称已经达到生产安全保障。
- 身份校验/加密测试、预约隔离集成测试、前端行为测试、登录边界测试和H5生产构建已通过；构建输出为tmp/reservation-id-h5-build。已验证密钥未进入前端JS、超大提交返回413、匿名详情返回401。
- 发布脚本已包含两个新模块，具体说明见BED_RESERVATIONS.md；本次未发布或修改线上环境。

## 20. 2026-10-29 预约必填标识、状态筛选和人数

- 预约表单六个字段全部显示红色必填星号，前后端统一必填及格式校验，提交时逐项展示错误，拒绝空白字符；0岁合法。
- 护士页面预约列表在search-bar下增加左侧状态下拉（全部状态、预约中、预约成功）和右侧总人数；患者列表保持不变。
- 搜索词与状态联合查询，筛选立即刷新、重置分页；人数是所有匹配预约记录数而非当前页数。
- 后端预约列表接口新增status与total，计数不应用分页cursor，计数和列表使用同一读取快照。
- 已验证筛选搜索组合、分页总数、异步过期响应防覆盖、全部必填提示、既有登录权限和身份加密回归，并通过H5构建。输出tmp/reservation-filter-h5-build，未发布线上。
## 21. 2026-10-29 修复预约模板多根元素报错

- 上一轮添加诊断必填错误提示的过程中，提示曾被插到预约页面根容器外，导致H5调试编译器报“Component template should contain exactly one root element”；文件修正后旧调试服务仍停留在此前错误。
- pages/bed-reservation/index.vue 保持唯一的 reservation-page 根view，六项错误提示全部位于对应form-field内；未提交区域统一由block v-if管理，与提交成功view v-else相对应；textarea改为显式闭合。
- 新增 scripts/check-vue-templates.cjs，使用HBuilderX自带Vue2编译器检查全部9个页面，并检查预约表单六个提示的嵌套位置。
- 已通过模板检查、预约前端行为和登录边界回归测试；仅重启本项目8081的H5调试服务，新服务编译正常、页面返回200，后端及数据库未停止。后续检查调试日志应选择tmp下时间最新的local-h5-*.log，不使用旧local-h5.stderr.log判断当前状态。
## 2026-10-29 预约验证码与状态箭头（本地，未部署）

- pages/nurse/list.vue 的 status-select-arrow 改用固定容器+CSS箭头，避免⌄字形基线导致不居中；保留原筛选布局。
- pages/bed-reservation/index.vue 的诊断下方接入必填图片验证码组件 components/reservation-captcha/index.vue。6位数字字母、大小写不敏感、300秒有效；支持点击图片/换一张、加载与过期提示、失败自动换图且保留业务字段。
- server/reservation-captcha.js 使用 crypto 安全随机答案和challenge ID，svg-captcha@1.4.0生成路径图。匿名 GET /api/bed-reservations/captcha 返回图片和ID，不返回答案。POST /api/bed-reservations 顶层传 captcha:{id,code}，在新记录写库前必须后端验证。
- 验证来源IP、有效期和一次性绑定；错误作废，正确绑定requestId+payload hash，不能用于新预约。已完成/并发的同请求保持幂等，不重复入库。原提交限流30次/IP/15分钟保留；图片获取单独60次/IP/15分钟，内存容量各10000。单进程，重启失效/重置，不是完整反机器人方案。
- 新增 server/tests/reservation-captcha.cjs；预约接口和前端回归覆盖验证码，隔离测试copy清单与发布模块清单已补新文件，模板检查覆盖组件和7个必填错误。
- 本地依赖已安装，package-lock已更新；现有 code-only 发布脚本会因线上锁文件不同安全退出。线上必须另行批准依赖感知发布，不要直接跳过检查或上传本地.env/node_modules。详细规则与限制见 BED_RESERVATIONS.md。
- 本次验证码/预约回归和H5构建通过；额外出院流程全量集成测试在本机因 PDFINFO_PATH/PDFTOPPM_PATH 均未配置、缺少可调用的Poppler转换程序，停在入院PDF转图片503，该失败不属于预约验证码接口。

## 2026-10-29 统一下拉箭头与预约中防重复提交（本地）

- pages/hzjbxx/index.vue（性别、年龄、诊断）与 pages/bed-reservation/index.vue（性别）的 picker-arrow，统一改为与护士列表 status-select-arrow 一致的空view + CSS伪元素箭头。三个页面共同引用 static/styles/picker-arrow.css，尺寸、颜色、间距和居中方式统一，避免重复样式偏移。
- 新预约以规范化后的18位身份证号作为“同一人”的识别依据，不按姓名/手机号单独判断。同身份证有 confirmed_at_ms IS NULL 的预约时，匿名提交返回409和 RESERVATION_ALREADY_PENDING，提示“您已有预约中的记录，请勿重复预约”，不返回已有患者资料。检查在验证码验证后进行。
- 仍保留 requestId+内容摘要的幂等回执，同一次已成功请求的网络重试不重复入库，不作为新预约拒绝。更换请求ID、姓名、电话等不能绕过同身份证的预约中限制。预约成功后允许再次预约。
- 身份证继续AES-GCM随机加密；新增 identity_fingerprint（带域分离的HMAC-SHA256，用已有独立 RESERVATION_ID_KEY）用于比较，不保存明文身份证或无密钥身份证散列，不在列表/详情回传指纹。禁止随意轮换该密钥；轮换需要同时迁移密文和指纹。
- 新增 pending_identity_fingerprint 存储生成列：预约中时为RTRIM(identity_fingerprint)，确认后为NULL，配合唯一索引 uq_bed_reservations_pending_identity，使不同设备/不同请求ID并发提交也最多落库一条预约中记录；确认状态更新时自动释放占用。RTRIM兼容CHAR列及PAD_CHAR_TO_FULL_LENGTH模式。
- 启动自动增加可空指纹列、生成列和唯一索引，不清除、不合并历史记录；历史无指纹且预约中的加密记录解密身份证比较，极早期无身份证记录按“姓名+手机号均一致”保守拦截。既有历史重复记录保留，但未全部确认前不能新增同人预约。历史兼容扫描只针对仍预约中且无指纹的记录。
- 前端重复预约失败保留用户填写信息，显示持续错误文字并自动更换验证码；换图不会清除重复提示，编辑业务字段或重新提交时清理旧提示。
- 新增测试：身份证指纹规范化/密钥依赖、老表/中断升级兼容、同身份证改名改电话及小写X重复、已确认可再约、不同身份证同名同电话可预约、6个不同请求并发防重、数据库直接重复写入拒绝、旧无身份证数据兼容、接口不泄露指纹、前端错误保留与清理、三个页面共享箭头样式。
- 本次未发布线上，依赖与上一版验证码版本一致；仍需遵守上一版依赖发布注意事项。

验证结果：预约全套自动化回归、10个Vue模板和共享箭头检查、H5生产构建均已通过；本地3000后端及8081 H5健康检查均为200。本次H5验证输出为tmp/h5-reservation-dedup-verification，未部署线上。

## 2026-10-29 正式发布完成（北京时间14:42）

- 已按用户明确授权，将本地本轮全部功能发布到 https://gzitwmkfk.cn，服务器仍为134.175.42.162，服务目录/opt/rehab-app/server。正式构建来自tmp/h5-production-20261029。
- 发布包含：首页免登录与受保护入口、匿名床位预约（手机号/身份证/全必填）、护士患者/预约Tab、预约状态筛选与总人数、预约详情/确认与等待天数、数字字母验证码、统一下拉箭头、预约中同身份证防重复。
- 线上原来没有bed_reservations表和RESERVATION_ID_KEY；本次创建独立预约表与防重生成列/唯一索引，服务器本机安全生成独立密钥，不沿用本地密钥，未输出密钥。只有该配置项新增，原数据库/JWT/分享域名/账号密码/Caddy均不变。
- 新svg-captcha依赖在服务器隔离暂存目录按锁文件npm ci --omit=dev --ignore-scripts安装；正式服务账号能够加载依赖并绘制验证码。没有上传本地.env、数据库、业务PDF或本地node_modules。
- 使用新增deploy/release-with-dependencies.sh进行依赖感知发布，deploy/release-support.cjs核对业务数据与文件，deploy/verify-reservation-release.cjs执行HTTPS和只读/拒绝写入验证。旧依赖树和旧public通过重命名保留，可回退；失败自动恢复旧代码，不回滚业务数据或删除加密密钥。
- 发布前数据：system_users=3，discharge_records=1，discharge_record_shares=1，discharge_record_flows=1，hospitalization_number_registry=1；预约表原先不存在。发布后原有行内容与PDF/固定文档指纹不变，预约表为0条，没有写入虚假患者或预约。两个有效报告/流程分享的HTML、PDF和JPEG均通过验证。
- 已验证：正式H5首页及新页面资源、300秒SVG验证码和no-store、匿名列表/详情受登录保护、无验证码的新预约返回400且不入库、带有效内部短期令牌的只读患者/预约列表与状态筛选/人数、防重唯一索引、固定入院PDF和图片。令牌仅内存使用，没有输出或落盘。
- 已从本机通过公网独立验证域名HTTPS、首页资源、验证码和匿名数据保护。服务rehab-web/caddy/mariadb/rehab-backup.timer均active，后端和数据库仍仅监听127.0.0.1；最终NRestarts=0。
- 程序回退备份：/root/rehab-code-release-20261029-144217-reservations（application.tar.gz、旧public、旧node_modules、原模块、私有数据指纹、environment-after-key.env）。目录700，密钥配置副本600。
- 发布前完整业务备份：/var/backups/rehab/rehab-20261029-144217.tar.gz；发布后包含新密钥与预约表的完整备份：/var/backups/rehab/rehab-20261029-144252.tar.gz。二者root私有600，未下载到本地。密钥恢复必须使用发布后备份，勿用无密钥旧.env覆盖新环境。
- 暂存目录：/home/ubuntu/rehab-release-20261029-reservations-1793255826993。正式程序由root:rehab持有，rehab仅程序读取，storage仍可写。
- 当前电脑SSH使用项目tmp/tencent-windows-deploy（不要读取/输出其内容），原文档C:/Users/Lenovo/.ssh/...路径在本机不存在。迁移过来的密钥ACL已收紧到本人、SYSTEM和管理员；本机记录主机密钥于tmp/rehab-known-hosts。主机ED25519指纹SHA256:frVh/L+yVlCv+qMiRhtcvjIMDYSVEr/c+0KmNVvNGHI。勿再使用旧Windows服务器部署脚本。
- 图片验证码/提交限流仍为单进程内存，重启重置，不能保证完全防机器人；该发布不等于渗透测试或真实身份认证。

## 2026-10-29 验证码改为4位（本地待发布）

- 按最新要求，预约图片验证码从6位改为4位，至少包含一个数字和一个字母，不区分大小写。
- server/reservation-captcha.js生成和后端校验、components/reservation-captcha/index.vue输入长度与截断、pages/bed-reservation/index.vue前端校验与提示已同步改为4位。
- 5分钟有效、错误作废、单请求绑定、获取/提交限流和重复预约校验不变；测试覆盖3/5/6位拒绝、4位大小写通过、前端输入清理与4位截断。
- 预约全套回归和10个Vue模板检查已通过。本轮仅修改本地，尚未将4位版本部署到服务器；此前正式发布的线上版本仍为6位。

## 2026-10-29 4位验证码正式部署完成（北京时间20:36）

- 已按用户本次授权，将4位数字字母混合、不区分大小写的预约验证码正式发布到 https://gzitwmkfk.cn。前端输入上限、格式校验、提示和后端生成/验证均为4位，5分钟有效期、换图、提交限流和预约中防重不变。此记录取代上文“4位版本本地待发布”的当前状态，历史记录保留。
- 正式构建：tmp/h5-production-captcha-four-20261029；暂存目录：/home/ubuntu/rehab-release-20261029-captcha-four-1793277317995。
- 本次使用新增deploy/release-captcha-four.sh，先校验完整性和所有未改动后端文件/依赖与线上一致，仅替换reservation-captcha.js和H5 public。不重装依赖，不更改数据库结构，不修改/重建RESERVATION_ID_KEY、原.env或Caddy。失败自动恢复旧验证码模块和public，不回滚业务数据。
- 本地预约全套测试、10个Vue模板和生产构建均通过。线上以实际rehab账号验证4位生成和SVG字体加载；验证4位混合、大小写不敏感、旧6位拒绝、HTTPS新资源、缺验证码不入库、登录保护、预约筛选/人数及数据库防重索引。两个现有有效报告/流程分享及入院PDF/JPEG仍正常；未插入测试患者/预约。
- 本机公网独立验证HTTPS、首页资源、4字符验证码图片（4字形路径+3干扰线）、300秒有效期、no-store和匿名列表401。
- 数据指纹前后复核一致：3个原账号、1条患者记录、1份报告分享、1份出院流程、1条住院号登记及0条预约均保留，业务文件、固定文档、密钥配置和代理配置未变化。
- 程序回退备份：/root/rehab-code-release-20261029-203616-captcha-four（application.tar.gz、旧验证码模块、old-public、preserved-data.json）。发布前完整业务备份：/var/backups/rehab/rehab-20261029-203616.tar.gz；发布后完整备份：/var/backups/rehab/rehab-20261029-203723.tar.gz。所有备份保留在服务器私有目录，没有下载患者资料或密钥。
- 发布后完整备份重启服务并再次检查，本地与域名/api/health均正常，rehab-web/caddy/mariadb/rehab-backup.timer均active，后端与数据库只监听127.0.0.1，NRestarts=0。用户如看到旧6位页面需刷新/重新打开。

## 2026-11-01 复诊须知姓名错别字修正（本地未部署）

- pages/hzjbxx/discharge-notices.js：白艳青改为白艳甫；邓眉帆改为邓眉敏；仅修正姓名，其余复诊时间、诊室和文字不变。
- 患者信息页生成出院报告时引用同一份followUpNotice，新生成报告使用修正姓名；已保存的历史PDF未改写。
- 本轮仅更新本地源码，未发布线上，未修改业务数据。

## 2026-11-01 复诊须知姓名修正正式部署完成（北京时间20:53）

- 已按用户授权发布到 https://gzitwmkfk.cn：复诊须知“白艳青”修正为“白艳甫”，“邓眉帆”修正为“邓眉敏”。新生成的出院报告使用修正内容，历史PDF未重生成/改写。此记录更新上一节本地未部署状态。
- 本次为纯H5发布，所有后端模块、package.json与package-lock.json和线上逐文件一致，不替换后端/依赖，不修改数据库结构、.env、预约加密密钥或Caddy。
- 新增deploy/release-followup-names.sh：私有备份、暂时停服、保留old-public、替换public、业务数据指纹验证、HTTPS检查和失败回退；新增deploy/verify-followup-names.cjs验证线上正式JS包含两个正确姓名且无旧错别字，不插入测试患者或预约。
- 本地姓名源数据/报告章节引用检查、10个Vue模板、预约全套回归和正式H5构建通过；产物tmp/h5-production-followup-names-20261101；患者页包pages-hzjbxx-index.29945da9.js。
- 暂存目录/home/ubuntu/rehab-release-20261101-followup-names-1793537456520；程序回退目录/root/rehab-code-release-20261101-205328-followup-names（700），含application.tar.gz（600）、old-public及preserved-data.json。完整业务备份/var/backups/rehab/rehab-20261101-205328.tar.gz（600），保留数据库、业务文件和加密配置，未下载至本地。
- 发布前后3个账号、1条患者、1份报告分享、1份出院流程、1条住院号登记、0条预约以及业务PDF/固定文档/配置指纹均一致；两个有效原分享及入院PDF/图片正常。4位验证码、缺验证码拦截、登录保护、预约状态筛选和人数/唯一索引检查继续通过。
- 本机公网独立验证HTTPS首页与静态资源、新JS包中的正确姓名；服务器最终health正常，rehab-web/caddy/mariadb/rehab-backup.timer均active，NRestarts=0。未清理业务数据，未改写历史报告。

## 2026-11-02 预约日期、特殊需求与取消预约

- 预约填写页增加必填“预约日期”，使用uni-app日期picker（年/月/日），按北京时间限制不早于今天，前后端均校验真实日历日期。原createdAt保留为“提交时间”，不用于代替用户选择的日期。
- “诊断”统一更名“诊断及病情介绍”，仍必填、最多500字；增加“特殊需求（选填）”，最多500字。验证码仍位于这两项之后，原手机号/身份证校验、匿名提交、防重复及幂等保留。
- 护士预约列表/详情展示预约日期、提交时间；详情展示特殊需求。旧数据日期显示“未填写”、特殊需求显示“无”，不编造历史日期。
- 筛选增加“取消预约”，总人数继续随搜索和状态变化。详情中预约中/预约成功可二次确认后取消，已取消不再展示确认/取消按钮；保存首次取消时间和操作账号，原确认审计保留。
- 新增reservation_date CHAR(10)、special_needs VARCHAR(500)、cancelled_at_ms、cancelled_by_user_id四个可空字段；启动升级旧pending_identity_fingerprint生成表达式，将cancelled_at_ms IS NULL纳入预约中条件，保留唯一索引和历史记录。取消自动释放同身份证防重占用；取消后可以重新申请，已取消不能确认。确认/取消采用条件UPDATE，重复取消不覆盖首次时间。
- “提前一天提醒”已按用户2026-11-02补充要求实现为护士入口预约列表的站内提示，见下节；不向患者发送短信或微信。
- 验证：预约全套回归、10个Vue模板检查及H5生产构建通过，覆盖北京日期边界/非法日期、取消幂等/并发/释放防重、历史记录兼容、筛选人数、前端操作互斥。原有患者页和二维码图片大小警告仍在。

## 2026-11-02 护士预约列表站内提醒（已发布）

- 接收人为护士，渠道为护士入口预约列表内的黄色“明日预约提醒”。日期按北京时间计算，统计预约日期等于明天、且未取消的全部预约（预约中和预约成功均包含），不受当前搜索、状态或分页影响；没有记录则不展示提示。历史未填写日期的记录不猜测、不提醒。
- 点击“查看名单”清空关键词和状态，切换到明日预约筛选；仍支持搜索、状态筛选、完整匹配人数和分页，“查看全部日期”退出日期筛选。明日预约卡片增加醒目标记。
- 打开/返回预约列表立即刷新提醒，在页面可见时每60秒检查；切换到患者Tab不查询，离开页面清理计时器并丢弃过期响应；跨北京时间午夜时重新计算日期，并刷新已打开的明日名单。请求失败显示可重试提示，不将失败当作无预约。
- GET /api/bed-reservations/reminders 需登录，只返回{date,total}且no-store；列表支持reminder=tomorrow，服务端统一计算日期，并在原事务快照内查询筛选后的总人数及分页。新增索引idx_bed_reservations_reminder(reservation_date,cancelled_at_ms)，保留业务数据和防重唯一索引。
- 这是站内即时提示，不是短信、微信或浏览器离线推送。护士需打开预约列表查看；没有新增付费服务、外部通知供应商、账号或配置密钥。沿用现有登录队列权限，项目目前不区分独立护士角色。
- 预约整套自动化和10个Vue模板校验已通过，新增覆盖提醒接口鉴权/隐私、北京日期边界/闰年/跨年、取消移除提醒、明日筛选/搜索/状态/分页人数、轮询/隐藏页面清理/旧响应丢弃/跨日刷新。

## 2026-11-02 正式发布完成（北京时间23:06）

- 用户明确授权后，已将预约日期、特殊需求、“诊断及病情介绍”、取消预约及护士前一天站内提醒一并发布到原网站gzitwmkfk.cn。正式H5构建：tmp/h5-reservation-reminders-20261102；发布暂存：/home/ubuntu/rehab-release-20261102-date-cancel-5323e0。
- 仅替换bed-reservations.js、reservation-validation.js与H5；其他后端模块及package/lock与线上逐文件一致，未改变依赖、账号、密钥、.env、Caddy或报告文件。
- 备份：/root/rehab-code-release-20261102-230601-date-cancel；完整数据库/文件备份：/var/backups/rehab/rehab-20261102-230601.tar.gz。使用deploy/release-reservation-date-cancel.sh，失败恢复原程序而不清空业务数据。
- 停服备份时数据：3账号、1患者、1报告分享、1出院流程、1住院号、1床位预约；迁移前后逐表原字段哈希、报告、固定文档、配置和代理均一致。新增四个可空字段，升级防重生成列，并添加提醒索引；历史未填写日期不补造日期，不触发明日提醒。
- 线上核验通过：HTTPS及正式页面资源、验证码、匿名访问保护、日期/特殊需求负例、预约筛选/人数、护士提醒汇总与明日名单、索引/防重表达式、原有2个报告/流程分享与固定入院PDF图片阅读、此前两个医生姓名修正；未向线上写入测试患者或测试预约。
- 最后健康核验（23:06:51北京时间）：rehab-web、caddy、mariadb、rehab-backup.timer均active且enabled，HTTPS /api/health返回ok:true，备份计时器已恢复。后端两文件SHA256与本地发布源一致。

## 2026-11-04 首页平台名称（本地修改）

- 按用户要求，将首页最上方原“功能入口”替换为“康复科患者服务平台”，保持原有入口、登录和退出逻辑不变。
- 同步pages.json的首页navigationBarTitleText；manifest.json中的name、h5.title和全局页面标题原本已为该名称，保持现状。
- 首页标题栏支持换行、退出按钮不压缩，避免手机窄屏时文字与按钮挤在一起。
- 新增首页名称与标题配置回归断言；首页/公开入口回归、10个Vue模板检查和H5生产构建通过，构建目录tmp/h5-platform-name-20261104，已核对首页产物包含新名称；原有体积警告不影响构建。
- 本轮未操作服务器、未部署线上，未更改后端或数据库。

## 2026-11-04 首页平台名称正式发布完成（北京时间19:08）

- 用户明确授权部署后，已将首页顶部“康复科患者服务平台”发布到原网站gzitwmkfk.cn，更新上一节本地未部署状态。仅替换H5 public，未更新后端、依赖、数据库结构、账号、密钥或代理配置。
- 正式构建tmp/h5-platform-name-20261104，首页包pages-index-index.5b024b4b.js；暂存目录/home/ubuntu/rehab-release-20261104-platform-name-50efb1。新增deploy/release-platform-name.sh及deploy/verify-platform-name.cjs，包含完整性核验、后端版本一致性检查、私有备份、业务数据指纹验证、失败恢复旧网页及HTTPS标题/原有入口验证。
- 回退备份/root/rehab-code-release-20261104-190822-platform-name；完整业务备份/var/backups/rehab/rehab-20261104-190823.tar.gz。
- 发布前后3账号、1患者、1报告分享、1出院流程、1住院号、1预约数据与报告/固定文档/配置指纹一致，未创建测试患者或测试预约。
- 本地预约全套回归、首页标题回归及10个Vue模板检查通过；线上HTTPS首页/浏览器标题及新首页JS精确字节比对通过，原5个入口、退出登录、预约验证码/筛选/人数/护士提醒、2个有效分享、固定入院PDF与图片阅读、复诊姓名检查均通过。
- 最终19:08:38北京时间健康检查正常，rehab-web/caddy/mariadb/rehab-backup.timer均active，每日备份计时器已恢复。

## 2026-11-04 登录页标题调整（本地未部署）

- 按用户要求，将pages/login/index.vue顶部brand-title从“康复科出院指导”改为“登录”；不修改图标、表单、按钮、样式或登录鉴权/返回逻辑。
- 当前护士、患者和出院流程入口共用此登录页，因此这些入口进入的登录页标题均为“登录”，首页平台名称保持“康复科患者服务平台”。
- 增加登录标题回归断言；登录/公开入口回归与10个Vue模板检查通过。
- 本轮仅修改本地，未重新构建发布包、未连接服务器或操作线上数据。

## 2026-11-04 登录页标题正式发布完成（北京时间19:18）

- 按用户明确授权，已将共用登录页顶部“康复科出院指导”改为“登录”并发布到gzitwmkfk.cn，更新上一节本地未部署状态。仅替换H5 public，后端、依赖、数据库结构、账号、密钥及代理配置保持不变。
- 正式构建tmp/h5-login-title-20261104，登录页包pages-login-index.33cf94f4.js。相比上一版仅登录页包与引用它的主入口包改变，其余页面脚本包名保持一致；首页仍显示“康复科患者服务平台”。
- 新增deploy/release-login-title.sh和deploy/verify-login-title.cjs，沿用完整性检查、后端逐文件一致性保护、私有备份、业务指纹核验及失败恢复旧网页。暂存/home/ubuntu/rehab-release-20261104-login-title-27cfd6。
- 程序回退备份/root/rehab-code-release-20261104-191843-login-title；完整业务备份/var/backups/rehab/rehab-20261104-191843.tar.gz。
- 备份时3账号、1患者、1报告分享、1出院流程、1住院号、1预约；发布前后业务数据/报告/固定文档/.env/Caddy指纹一致，未创建线上测试患者或预约。
- 本地预约与登录全套回归、10个Vue模板检查、H5构建通过；线上HTTPS验证新登录标题、旧标题移除、手机号/密码/返回首页控件、首页平台名称与原入口、预约验证码/状态筛选/人数/护士站内提醒、2个有效分享、固定入院PDF与图片及复诊姓名检查均通过。
- 最终19:19:07北京时间，HTTPS健康返回ok:true，rehab-web/caddy/mariadb/rehab-backup.timer均active，每日备份计时器正常恢复。

## 2026-11-06 再次预约选项与预约日期选填（本地未部署）

- 按本轮需求，在床位预约表单新增“是否再次预约”下拉选项，选“否/是”，默认“否”，共用现有居中箭头样式。该项是患者本次预约声明，不是自动识别历史预约，也不允许绕过仍预约中的同身份证防重限制。
- 预约日期改为选填，移除必填红星及缺失错误，标注“预约日期（选填）”；增加“清除日期”，选择后可恢复留空。仍保留手机号、身份证、姓名、性别、年龄、诊断及病情介绍和图片验证码的既有必填校验；特殊需求继续选填。填写日期时仍校验真实日历及不能早于北京时间当天。
- 前后端均接受预约日期缺失/null/空字符串/纯空格；后端规范化为空字符串参与请求摘要，数据库存SQL NULL，不保存假日期。未填写日期不进入护士明日提醒及明日名单，页面已说明；已有日期的原提醒规则不变。
- 新增可空repeat_reservation TINYINT UNSIGNED列；新记录是/否存1/0，护士列表及详情展示是否再次预约。旧记录保留NULL并显示“未填写”，不编造历史选择。旧客户端缺少此项时新提交默认否，错误类型或非是/否值拒绝。
- 请求摘要包含再次预约选项，修改选项或日期会被视为新内容；保留旧版无该字段且默认否的历史请求摘要兼容，已提交网络重试不重复入库，修改为是/更改日期不能使用原请求ID冒充原请求。
- 本地预约全套回归、10个Vue模板检查及H5生产构建通过，产物tmp/h5-repeat-reservation-optional-date-20261106，已核对表单与护士列表/详情的新字段。原有患者页/二维码资源体积警告仍存在，不影响构建。新增覆盖选项默认值/持久化/历史NULL显示、日期空值与类型/日历校验、清除日期/提交中锁定、旧表增量升级保留字段、前端失败保留与重试、未填日期不提醒、再次预约选择不绕过防重、旧版回执幂等兼容。
- 本轮未连接服务器、未部署线上；后续发布包含后端与增量字段，不能复用只更新H5且拒绝后端差异的release-login-title.sh/release-platform-name.sh。deploy/verify-reservation-release.cjs已补充新字段与无日期但无验证码时拒绝写入的负例，为后续正式发布准备。

## 2026-11-06 患者基本信息选填与报告电话范围调整（本地未部署）

- 患者入口基本信息中的“管道类型”“皮肤情况”改为选填：去除必填星号、明确显示“（选填）”，同步移除前后端非空限制。保留“有无管道”、患者联系电话及其他原有必填规则；有出院带药时药物类型仍必填。
- 管道为“有”但未选类型、以及未选皮肤情况时，报告显示“未填写”，不误写为“无”；实际已选护理内容继续正常生成，未选管道类型不添加空注意事项标题。
- 根据用户澄清，仅移除新生成出院报告及其报告快照中的患者联系电话；患者档案和护士详情中的联系电话继续保存、展示。复诊须知的科室电话和病历复印业务咨询电话原样保留，不修改历史已保存PDF。
- 新增server/tests/patient-report.cjs，覆盖选填标签、表单提交、报告快照、真实PDF内容及后端校验；扩展server/tests/bed-reservations.cjs中的本地临时数据库集成测试，检查空/缺失/null选项保存、电话留档、必填规则、住院号防重和请求重试。相关测试、完整预约回归及10个Vue模板检查均通过。
- H5生产构建通过，产物tmp/h5-patient-optional-no-phone-20261106，包含上一节尚未发布的再次预约/预约日期选填功能；原有资源体积警告不影响构建。4种虚拟患者报告共11页完成内容核验及图片渲染检查，患者电话已移除、两处公共电话保留。
- 本轮未连接服务器、未部署。后续发布必须同步server/index.js及此前未发布的预约后端改动，不可仅更新H5；线上历史报告不自动重写。

## 2026-11-06 预约与患者信息调整正式部署完成（北京时间10:06，10:08复核）

- 按用户明确授权，将此前未发布的再次预约声明、预约日期选填、患者管道类型/皮肤情况选填及报告电话范围调整发布到gzitwmkfk.cn；此条更新前两节本地未部署状态。只去掉新报告的患者电话，科室/病历复印电话及患者私有档案电话保留，历史PDF不改写。
- 生产构建tmp/h5-production-patient-reservation-20261106，患者页pages-hzjbxx-index.efe9f07e.js；暂存/home/ubuntu/rehab-release-20261106-patient-reservation-a10320。新增deploy/release-patient-reservation.sh与deploy/verify-patient-reservation.cjs，精确核对旧版基线、包完整性、备份、失败代码恢复与只读验证。
- 仅替换H5 public、server/index.js、bed-reservations.js和reservation-validation.js；增量添加可空repeat_reservation字段，不修改旧记录、依赖、.env、密钥或代理配置。发布前后3账号、3患者、3报告分享、2出院流程、3住院号及3预约的原字段/业务文件指纹保持一致。
- 程序回退备份/root/rehab-code-release-20261106-100629-patient-reservation；发布前完整备份/var/backups/rehab/rehab-20261106-100630.tar.gz，发布后完整备份/var/backups/rehab/rehab-20261106-100828.tar.gz，私有权限600，均留在服务器。
- 本地完整预约回归、患者报告测试、10个Vue模板及正式构建通过；线上HTTPS实际页面包、新报告方法/后端校验、验证码、筛选人数、护士明日提醒、5个有效历史分享及固定入院PDF/图片核验通过。公网独立核验首页与6个页面包逐字节一致，匿名列表仍401；未写入线上测试预约或患者。
- 备份后服务短暂启动等待结束，10:08:51北京时间最终健康检查ok:true；rehab-web/caddy/mariadb/rehab-backup.timer均active，NRestarts=0，备份结果success，下一次每日备份为2026-11-07 03:00北京时间。
- 用户紧接着提出新需求：取消患者端再次预约声明，改由护士列表再次预约，并增加删除预约信息。该新需求尚未包含在本次已完成发布中，后续开发/发布须单独记录。

## 2026-11-06 再次预约改至护士列表并增加删除（本地完成，尚未发布）

- 用户在上一版部署完成后调整需求：取消患者填写页的“是否再次预约”，改为护士入口预约列表上的操作，并增加删除预约信息。本轮未连接服务器、未修改线上；线上仍是10:06发布版本。
- 患者预约页移除下拉选项/数据/校验提示/事件，预约日期继续选填；后端保留旧客户端repeatReservation字段与幂等摘要兼容，不改写已存在记录或历史声明。
- 护士列表：预约成功/取消预约卡片可“再次预约”，预约中隐藏按钮；弹窗展示原患者姓名并说明复用资料，重新选择预约日期或留空（默认空，不沿用旧日期）。后端从原记录读取身份、诊断及特殊需求，新建预约中记录并重新计时；原记录保留，新记录标记“再次预约”。缺身份证号的历史记录不可代建，提示患者重新填写。
- 新增受登录保护的POST /api/bed-reservations/:id/rebook及DELETE /api/bed-reservations/:id；仍沿用项目现有登录共享队列权限，没有新增角色体系。再次预约来源和操作者存新增可空rebooked_from_id/rebooked_by_user_id。事务锁、请求幂等及身份证唯一索引保持并发防重，加密身份证重新绑定新请求。已有预约中数据时不允许新建。
- 每条预约均有删除操作；确认窗口明确永久删除不可恢复，只删除所选预约、不删除患者档案或其他预约。删除幂等，不设置级联，删除原记录不影响已新建再次预约。按钮阻止冒泡，避免误跳详情；弹窗出现前隐藏旧提示防止遮挡。
- 操作后保留筛选条件刷新列表/总人数/明日提醒；空日期不触发提醒。请求失败保留输入和请求标识，双击及提交中编辑锁定；删除取消/失败不更新假数据。
- 完整预约回归、患者报告回归、10个Vue模板及正式H5构建通过。最终构建tmp/h5-nurse-rebook-delete-final-20261106；隔离临时数据库覆盖鉴权/数据保留/字段复制/日期提醒/幂等与并发/删除范围/防重释放/迁移重试。浏览器使用虚拟API数据核验手机390px与电脑1280px界面，实际点击再次预约/删除及人数刷新，无页面运行异常，截图tmp/nurse-rebook-delete-ui-20261106。
- 同步BED_RESERVATIONS.md、自动化测试及deploy/verify-patient-reservation.cjs、verify-reservation-release.cjs。后续必须发布H5与server/bed-reservations.js并执行增量迁移；已用的release-patient-reservation.sh固定旧基线仅适用于上一版，后续不能直接重用，需准备新的基线核验与备份发布脚本。

## 2026-11-06 护士再次预约与删除正式部署完成（北京时间10:51发布，11:02复核）

- 按用户明确授权，已将护士预约列表“再次预约”和“删除预约”发布到gzitwmkfk.cn；患者填写页移除“是否再次预约”，日期继续选填。此记录更新上一节本地未发布状态。原患者管道/皮肤选填、报告只隐藏患者电话而保留公共电话等已发布功能保持。
- 正式产物tmp/h5-nurse-rebook-delete-final-20261106；网页患者预约包pages-bed-reservation-index.93c7e3fa.js、护士列表包pages-nurse-list.9d9d17a8.js、预约详情包pages-nurse-reservation-detail.497aead7.js。暂存/home/ubuntu/rehab-release-20261106-nurse-rebook-delete-da2c84；上传包SHA256 ce511e10ad607e4d21eaff86a416edc1ce89b90f9fd08af85a1d7167cb469999。
- 新增deploy/release-nurse-rebook-delete.sh和verify-nurse-rebook-delete.cjs：仅替换H5 public与server/bed-reservations.js，发布前精确校验旧版模块SHA256与其余后端/依赖一致；私有备份，失败恢复代码，保留所有业务数据。新增可空rebooked_from_id/rebooked_by_user_id，未修改账号、环境/加密密钥、依赖或Caddy。已核对发布后后端SHA256与本地一致：9a6990a16dafdb932a409be9401d19e0dd07423dfc904da32a880f685727a9b7。
- 程序回退目录/root/rehab-code-release-20261106-105112-nurse-rebook-delete（700），application.tar.gz及数据指纹快照600；发布前完整备份/var/backups/rehab/rehab-20261106-105112.tar.gz，发布后完整备份/var/backups/rehab/rehab-20261106-110144.tar.gz（600），均留在服务器私有目录。
- 发布前后3账号、3患者、3报告分享、2出院流程、3住院号和3预约的原字段/报告/固定文档/配置指纹保持一致。未在真实线上执行成功再次预约或删除操作；写入逻辑已在本地隔离数据库、手机/电脑虚拟UI验证。线上只做读操作与必定拒绝的负例：匿名再次预约/删除401、已登录无效编号0的再次预约/删除400，不影响实际数据。
- 本轮重新通过完整预约/验证码/身份证/护士操作/患者报告自动测试、10个Vue模板、正式包内容及手机/电脑虚拟交互检查。线上HTTPS新资源、预约日期选填/患者选项移除/护士操作文案、受保护新路由、增量字段、筛选人数/护士提醒/防重索引、5个有效历史报告/流程分享及固定入院PDF/图片全部通过；公网独立核对首页主入口资源及6个页面包逐字节一致，匿名业务列表仍401。
- 11:02:47北京时间最后HTTPS健康ok:true。rehab-web/caddy/mariadb/rehab-backup.timer均active，NRestarts=0，发布后备份Result=success；下次每日备份2026-11-07 03:00北京时间。网页如有缓存，刷新/重新打开即可。

## 2026-11-11 床位预约增加预约医生与多选管道（本地完成，尚未发布）

- 预约填写页新增“预约医生（选填）”下拉，按用户顺序提供殷茵、杨浩宇、朱广浩、姚志远、其他；可清除选择，不额外要求“其他医生”文本。新增“管道（选填，可多选）”，依次提供胃管、尿管、PICC管、气切管、CVC管、胃造瘘管、输液港、其他，选择其他时显示带必填标记的管道名称输入，1—100字；取消其他会清空隐藏内容。两项本身按选填实现，未选择不阻止提交。复用既有选择箭头与表单样式，提交中禁用编辑。
- 新增共享选项与normalizeReservationCare：前后端校验医生/管道枚举、类型/长度、其他管道非空；管道按固定选项顺序去重，按数组提交（修正原通用字符串化对新数组不适用的情况），名称去首尾空白，未选其他时不保存其内容。提交失败保留输入，同内容重试复用请求标识。
- server/bed-reservations.js增量添加可空doctor VARCHAR(20)、tube_types TEXT、other_tube VARCHAR(100)，新增记录持久化医生、多选JSON与其他名称。旧记录保留NULL，详情映射空值显示“未填写”，不编造历史填写。护士预约详情显示新增两项，多选以顿号连接，其他连同填写名称显示；列表响应继续不携带新增临床详情。
- 护士再次预约由后端复制原预约医生/管道/其他名称，前端确认说明同步；仍重选预约日期、保留原记录、遵守预约中防重。新字段加入提交与再次预约幂等摘要；当新字段全空时兼容此前有/无repeatReservation的旧提交摘要及旧护士再次预约摘要，新增或更改医生/管道不能冒用旧回执。
- 完整预约自动化通过，新增覆盖五医生、八管道顺序、多选/去重/其他条件必填/非法输入/长度、匿名回执与列表隐私、实际SQL保存/详情读取、护士再次预约继承、空选项/旧表迁移/重复迁移保留值、旧提交/护士回执兼容、字段变更拒绝伪重试。表单回归覆盖数组不被字符串化、其他撤销清空、提交锁定/失败保留与清空、护士详情展示。患者报告回归及10个Vue模板（预约12个错误提示）通过。
- H5生产构建tmp/h5-reservation-doctor-tubes-20261111通过，仅有原资源体积提醒。虚拟API浏览器验证真实多管道勾选、医生处理函数、其他输入、完整表单提交数组载荷、护士详情及原再次预约/删除操作，手机390px与电脑1280px无运行错误。截图tmp/reservation-doctor-tubes-ui-20261111/public-booking.png及nurse-care-detail-mobile.png；未使用真实患者资料。
- 本轮为本地开发：已启动本地数据库/后端完成隔离测试，未连接服务器、未部署。线上仍为2026-11-06护士再次预约/删除版本。后续发布需同时更新H5、bed-reservations.js和reservation-validation.js并增量迁移；已同步只读发布核验，旧release-nurse-rebook-delete.sh仅覆盖单后端模块/旧基线，不能直接用于本次发布。

## 2026-11-11 预约医生与多选管道正式部署完成

- 用户授权后，已将上一节本地待发布功能部署至gzitwmkfk.cn；正式发布时间北京时间11:38:06，发布后备份与健康复核时间22:43:38。新增预约医生下拉（殷茵、杨浩宇、朱广浩、姚志远、其他）、多选管道及“其他”自填，医生/管道继续选填，勾选其他管道时名称必填；护士详情展示，护士再次预约继承这些资料。
- 正式构建：tmp/h5-reservation-doctor-tubes-20261111；发布暂存：/home/ubuntu/rehab-release-20261111-reservation-doctor-tubes-0f7f3a。仅替换H5、bed-reservations.js及reservation-validation.js；三个可空字段增量升级，未改变依赖、其他后端、账号密钥、环境或代理。
- 程序回退备份：/root/rehab-code-release-20261111-113806-reservation-doctor-tubes。完整数据库/文件备份：/var/backups/rehab/rehab-20261111-113806.tar.gz及/var/backups/rehab/rehab-20261111-224337.tar.gz，权限均600。发布脚本deploy/release-reservation-doctor-tubes.sh带精确旧版本基线和失败代码恢复，不将旧数据库覆盖新写入。
- 发布停服快照为3账号、3患者、3报告分享、2出院流程、3住院号和4条预约；迁移前后原字段/文件指纹一致，历史报告与5个有效报告/流程分享保持正常。未向生产写入测试预约或执行真实删除。
- 完整预约回归、患者报告回归、10个Vue模板、手机/桌面生产包虚拟接口测试通过。线上只读核验doctor/tube枚举和条件校验、旧空值兼容、三列、列表隐私、验证码/防重复/登录保护/筛选人数/护士提醒及固定文档通过；公网独立比对首页、主资源和6个页面包逐字节一致。
- 最终HTTPS健康ok:true；rehab-web/caddy/mariadb/rehab-backup.timer全部active，NRestarts=0，备份结果success；下次定时备份2026-11-12 03:00北京时间。两个后端源文件SHA256与服务器一致。

## 2026-11-11 删除预约报“预约服务暂不可用”已线上修复（北京时间23:03复核）

- 用户反馈护士预约列表点击删除报通用错误。线上日志发现10次ER_TABLEACCESS_DENIED_ERROR；以应用实际数据库账号执行恒假DELETE验证，确认缺少DELETE权限。历史部署只授予SELECT/INSERT/UPDATE/CREATE/ALTER/INDEX，本地隔离测试使用高权限账号，旧发布探针用编号0在SQL前就400，均未覆盖真实应用数据库账号权限。
- 仅向实际应用账号授予当前数据库bed_reservations表的DELETE权限，不授予其他表或数据库的DELETE，不更换账号/密码，不改前后端页面、不重启服务、不修改现有预约数据。
- 新增deploy/fix-reservation-delete-permission.cjs，支持inspect/apply；应用账号执行DELETE WHERE 1 = 0精确检查权限。apply前保存原授权和仅撤销本次表级授权的rollback.sql到/root/rehab-permission-fix-2026-11-11T14-54-39-090Z（目录700/文件600；可能包含敏感授权信息，不打印或下载）。工具仅在缺权限时补授权，可重复运行。
- 使用确认未分配且远高于当前ID/自增值的安全整数编号，经实际线上登录保护的DELETE接口返回200并重复200；匿名访问401。没有真实预约被删除。真实连接池无需重启即可生效。
- 后续deploy/verify-reservation-release.cjs增加使用.env应用数据库账号执行恒假DELETE/affectedRows=0，缺权限立即失败；不再只依靠root只读检查和非法ID探针。修复工具与新版检查在/home/ubuntu/rehab-maintenance-delete-permission-20261111，原发布暂存文件恢复为原包版本。
- 修复后完整线上检查通过：预约登录保护/验证码/筛选人数/明日提醒/索引、5份历史报告/流程分享、固定入院PDF图片、页面资源；rehab-web/caddy/mariadb/rehab-backup.timer均active，健康ok:true。无需重建H5，用户刷新重试即可。权限修复不是代用户执行删除，页面仍需用户确认永久删除。

## 2026-11-11 预约仅排队登记提醒（本地调整，尚未发布）

- 按用户要求确定交互：进入床位预约页后，标题下、表单上方常驻浅黄色警示；提交前填写校验通过后弹出同文确认。统一文案为“⚠️预约仅排队登记，须等康复科电话通知入院，未通知请勿自行来院。”。不在入页时强制弹窗、不新增反复勾选，避免打断填写。
- 确认框标题“提交前请确认”，按钮“已知晓，提交”/“返回检查”。返回、关闭、弹窗失败均不请求提交接口、不清空资料/验证码；确认后才提交。等待确认及请求中锁定表单/按钮，防重复弹窗与双击。确认后重新校验当前验证码及北京时间日期，处理停留过久导致失效。网络失败沿用现有保留输入、换验证码及请求ID幂等流程。
- 顶部提示在提交成功后仍保留；成功文案改为“当前状态：预约中（仅排队登记）。请等待康复科电话通知入院。”，不暗示提交即获床位。
- 仅调整pages/bed-reservation/index.vue和前端测试；无需改后端/数据库，不将提示确认当作已存入数据库的法律签署。新增自动化覆盖常驻位置、先校验后弹窗、提示与按钮文案、取消/失败/过期不提交、保留输入、确认/请求防重及成功不可重复提交。
- 本轮未连接服务器、未发布；用户可先确认交互方案，后续授权再上线。

- 验证结果：新增提醒流程前端测试、10个Vue模板、患者报告回归均通过；完整预约回归首跑在既有跨历史记录并发再次预约场景偶发返回500，未改后端，复跑全套通过（该并发边界仍建议单独排查，不属于本次提示改动）。H5正式构建tmp/h5-reservation-admission-notice-20261111完成，仅原资源体积警告；虚拟API真实浏览器验证顶部提醒、提交弹窗、取消保留输入且零提交、明确知晓后提交、成功页提示及护士原功能通过，手机390px和桌面1280px无JS错误。手机确认按钮精简为“已知晓，提交”，视觉核对无折行。截图tmp/reservation-admission-notice-ui-20261111/public-booking.png和submission-confirmation-mobile.png。尚未发布服务器。

## 2026-11-12 预约排队登记提醒正式部署完成（北京时间09:43）

- 用户明确授权部署后，将上一节本地待发布提醒功能发布至gzitwmkfk.cn。页面顶部浅黄色常驻“⚠️预约仅排队登记，须等康复科电话通知入院，未通知请勿自行来院。”；资料校验通过后点击提交再次弹窗，按钮“已知晓，提交”/“返回检查”；成功页继续提醒等待康复科电话通知。
- 干净生产构建tmp/h5-reservation-admission-notice-release-20261112；上次本地构建目录有两次构建残留哈希包，因此本轮改用新目录构建，未复用含多份旧包的目录。完整前端回归、10个Vue模板、手机390px/桌面1280px虚拟API浏览器验证通过，覆盖取消不提交/保留输入、确认才发送、成功页提醒及原护士再次预约/删除功能，无页面异常。只有原有资源体积警告。
- 发布暂存/home/ubuntu/rehab-release-20261112-admission-notice-e4083f，发布脚本deploy/release-admission-notice.sh；仅替换H5 public，全部后端源码/package/lock逐字节与线上一致。无数据库迁移、权限/配置/密钥改动，上次预约表DELETE授权保留。新专项deploy/verify-admission-notice.cjs核对HTTPS实际预约页面包及提示/确认文案。
- 程序回退备份/root/rehab-code-release-20261112-094327-admission-notice；发布前数据库/文件完整备份/var/backups/rehab/rehab-20261112-094327.tar.gz，发布后完整备份/var/backups/rehab/rehab-20261112-094350.tar.gz，权限600。失败自动回退旧H5，不覆盖业务数据库。
- 发布前实时快照为3账号、3患者、3报告分享、2出院流程、3住院号、1条床位预约；发布前后原业务数据/报告/固定文档/环境/代理指纹一致。预约数量按本次实时状态记录，不沿用上次4条快照。未向线上提交测试预约或删除真实预约。
- 线上检查通过：新提醒与提交确认包、平台名和登录标题、医生/管道及旧数据兼容、患者报告仅移除患者电话、验证码、登录访问保护、预约筛选人数/护士提醒/索引、5份有效历史报告和流程分享、固定入院PDF图片。新增的真实应用数据库账号恒假DELETE权限检查通过，affectedRows=0。
- 外部独立HTTPS核验正式首页/主资源/6个页面包与新构建逐字节一致，匿名患者和预约列表均401。最终复核时间2026-11-12 09:43:51北京时间，健康ok:true，rehab-web/caddy/mariadb/rehab-backup.timer均active，NRestarts=0，备份success；下次自动备份2026-11-13 03:00北京时间。

## 2026-11-12 患者详情二维码标题调整（本地完成，尚未部署）

- 按用户要求，将pages/nurse/detail.vue中二维码卡片标题由“患者报告二维码”改为“患者出院报告二维码”。仅修改标题文案，二维码链接、有效期和分享功能保持原样。本轮未连接服务器、未部署。

## 2026-11-12 准备上传 GitHub（等待登录与目标仓库）

- 用户要求将项目代码上传自己的GitHub。当前目录原来不是Git仓库，已初始化main分支，尚未设置远程仓库或推送。GitHub账号列表为空，本机无gh命令；使用现有Git Credential Manager的官方登录流程即可，不要求用户提供密码或访问令牌。
- 补充根README.md及.gitignore，排除output、.playwright-cli、project.private.config.json、环境文件、私钥、数据库导出及备份压缩包；保留原tmp/server/storage/server/public/node_modules等排除规则。源码、固定入院文档、依赖清单、配置示例和开发记录准备入库，最近患者详情二维码标题修改包含在内。
- 待提交文件121个约1.92MB，私钥/GitHub令牌/AWS凭据/带密码URL模式检查未发现混入；真实.env、SSH私钥、患者PDF、浏览器快照、备份均经git check-ignore确认排除。还需GitHub登录及目标仓库信息才能实际上传。

## 2026-11-12 GitHub 目标仓库已提供

- 用户提供目标https://github.com/yqshidada/kfkhzfwpt.git；通过GitHub官方API确认归属yqshidada，当前为公开仓库、默认分支main、size为0。此前拟建私有仓库的建议不作为实际目标，遵循用户提供的仓库。
- 本地代码已暂存，配置origin指向上述仓库；首次提交使用GitHub账号yqshidada及其官方账号ID对应的隐私邮箱56528141+yqshidada@users.noreply.github.com，不需要收集个人邮箱。
- 本机GitHub凭据列表为空；github.com:443连接超时，但api.github.com可访问。尚未完成GitHub登录授权或远端推送；本地提交不等于上传成功。后续接续先确认网络和官方登录，再检查远程分支，普通push，不force覆盖。

## 2026-11-12 完整源码已上传 GitHub

- 用户提供仓库并完成GitHub官方授权后，已将完整项目源码推送至https://github.com/yqshidada/kfkhzfwpt.git的main分支，已设置origin及main上游。初始提交529b2080ba139c9398480b996bedff82baea71d9，远程ls-remote及GitHub官方API逐项核验一致。
- GitHub目录树含121个文件，包含前端页面、后端、依赖锁文件、固定入院文档、环境示例、测试、部署脚本、README和开发记录。不是将整个项目打成压缩包后上传，支持正常git clone及后续提交；包含“患者出院报告二维码”最新本地修改，该标题尚未部署到正式服务器。
- 真实server/.env、tmp、output、server/storage、server/public、依赖目录、浏览器快照及个人开发配置均未进入远程目录树。克隆后按README安装后端依赖并配置本机数据库/独立密钥，不能依赖未上传的本机私有环境。
- 目标仓库目前为用户提供的公开仓库，未修改其可见性。未force覆盖远程历史，亦未修改正式服务。提交身份仅在本仓库配置，使用GitHub隐私邮箱。
