# Ubuntu 服务器迁移与运维

迁移日期：2026-10-13（北京时间）。

## 当前服务器

- Ubuntu：`134.175.42.162`，SSH 用户 `ubuntu`，腾讯云广州地域。
- 当前入口（2026-10-22 17:52 北京时间）：`https://gzitwmkfk.cn`；用户确认备案通过后已恢复域名入口，`SHARE_BASE_URL=https://gzitwmkfk.cn`。
- `www.gzitwmkfk.cn`、域名 HTTP 及旧 IP HTTP 均跳转至主域名 HTTPS。旧 IP 使用 308 并保留路径、查询参数，让已发出的有效二维码继续访问原报告。
- 两条 A 记录已核验指向新 IP。
- Node.js 22、MariaDB 11.8、Caddy 2.6（Ubuntu 软件源安装）。
- 原 Windows 服务器 `193.112.28.250` 暂时保留，其 Caddy 已通过带证书校验的 HTTPS 转发至新服务器，用于 DNS 缓存过渡。旧数据库保留，但不再接收网站业务请求。
- 广州地域仍需解决域名备案/接入限制；服务器内部 HTTPS 通过不等于所有公网网络都已可访问。

## 已迁移与验证

数据库完整导入，包括 3 个原有账号及密码哈希；导出时患者记录、住院号登记、分享记录均为 0，报告目录为空。保留原 JWT 签名配置和分享域名。新服务器使用独立的数据库连接密码，未修改用户登录密码。

后端文件与 H5 首页 SHA-256 与原服务器一致。已通过真实服务账户运行的接口验证：登录、保存/搜索/详情、账号隔离、住院号去重、北京时间、二维码生成、匿名 PDF 获取、分享撤销、私有文件隔离、H5 首页引用资源。测试记录和文件已清理，数据库数量恢复到迁移前状态。

## 路径与服务

| 内容 | 路径/名称 |
| --- | --- |
| 后端与 H5 | `/opt/rehab-app/server`、`/opt/rehab-app/server/public` |
| 配置 | `/opt/rehab-app/server/.env`，仅 root 和 rehab 服务账号可读 |
| PDF | `/opt/rehab-app/server/storage/reports` |
| 后端服务 | `rehab-web.service`，以 rehab 用户运行 |
| HTTPS | `caddy.service`，配置 `/etc/caddy/Caddyfile` |
| 证书和续期账户 | `/var/lib/caddy/rehab-data`，仅 caddy/root 可访问 |
| 数据库 | `mariadb.service`，仅监听 `127.0.0.1:3306` |
| 每日备份 | `rehab-backup.timer`，北京时间 03:00 |
| 备份文件 | `/var/backups/rehab/rehab-*.tar.gz`，root 私有，保留 30 天 |
| 迁移快照 | 新机 `/root/rehab-migration`；旧机 `C:\rehab-deploy\migration-134-175-42-162` |

后端仅监听 `127.0.0.1:3000`。云端只需开放 SSH、HTTP 80、HTTPS 443；不要开放数据库或 3000 端口。Caddy 使用迁移的有效证书，自动续期依赖域名指向正确且 HTTP 80 可达。

## 登录与检查

本机 PowerShell：

```powershell
ssh -i C:\Users\Lenovo\.ssh\kfkxcx-tencent-deploy ubuntu@134.175.42.162
```

新服务器终端：

```bash
sudo systemctl status rehab-web caddy mariadb --no-pager
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS --resolve gzitwmkfk.cn:443:127.0.0.1 https://gzitwmkfk.cn/api/health
sudo journalctl -u rehab-web -n 80 --no-pager
sudo journalctl -u caddy -n 80 --no-pager
systemctl list-timers rehab-backup.timer
```

服务均已设置开机自启动。Node 服务异常退出会自动重启。系统时区为 Asia/Shanghai。

## 更新

2026-10-26 09:51（北京时间）已发布扫码图片阅读版本，继续使用 `https://gzitwmkfk.cn`。三类二维码按页显示 JPEG，支持放大并保留 PDF 下载；安装 `poppler-utils`、`poppler-data`、`fonts-noto-cjk`，派生缓存位于 `storage/image-cache`，由原分享有效期与撤销规则控制访问。另修正 PDF 文字绘制中多余的 BOM，避免 Linux 转图显示方框，H5 已重新构建。

按用户本次明确要求，备份后清空四张患者业务表及生成文件：原有 1 条患者记录、1 条报告分享、1 条出院流程、1 条住院号登记及 2 个 PDF 已删除；保留 3 个用户账号，清理前后完整用户行指纹相同。固定入院文档保留，公共入院图片缓存可按访问重新生成。程序回退备份：`/root/rehab-code-release-20261026-094951/application.tar.gz`；清理审计与前后指纹：`/root/rehab-patient-reset-20261026-095133`；清理前业务备份为 `/var/backups/rehab/rehab-20261026-095134.tar.gz`，未删除历史备份。域名验证覆盖登录、记录生成/搜索/详情、账号隔离、重复生成限制、三类图片、PDF 下载、分享撤销与到期，临时数据均清理。

`clear-patient-data.sh <暂存目录> --clear-all` 仅用于用户明确要求清空数据时，自动停止后端、备份、删除患者数据和缓存，并验证用户及站点配置未变；日常发布不要执行该脚本。它不会删除用户、固定入院文档或恢复备份。

2026-10-22 17:52 已恢复域名 HTTPS 访问，仅修改分享地址和 IP 跳转配置，没有清库或重新生成已有报告。原配置备份：`/root/rehab-domain-switch-20261022-175215`。`verify-domain-release.cjs` 已验证可信 TLS、登录、报告生成、账号隔离、流程去重及三类域名二维码；临时数据已清理。公网域名健康检查及旧 IP 跳转下载 PDF 均通过。后续域名部署验证使用此脚本，`verify-ip-release.cjs` 仅适用于此前 IP 模式。

2026-10-22 16:47（北京时间）已完成仅代码发布：重新构建并更新 H5、后端和最新一页大字体入院 PDF，继续使用 `http://134.175.42.162`。旧程序备份为 `/root/rehab-code-release-20261022-164708/application.tar.gz`，发布前业务备份由 `rehab-backup.service` 完成。66 个发布文件校验通过；业务表、报告文件、账号、环境配置和代理配置指纹保持一致。线上登录、报告保存/搜索/详情、账号隔离、重复生成拦截、二维码和匿名 PDF 下载均验证通过，临时验证记录已清理。公网首页及入院 PDF 与本地发布文件哈希一致。

2026-10-21 发布包含入院流程固定 PDF、二维码详情页、出院流程填写及不可重复生成规则、首页新图标。发布前备份后清空患者记录、报告分享、出院流程及住院号登记，删除 `storage/reports` 下全部生成文件，保留登录账号和 `documents/admission-flow.pdf`。`release-ip-access.sh` 为本次包含清库的一次性发布脚本，**不要用于日常更新**。`verify-ip-release.cjs` 可验证 IP 入口的登录、账号隔离、报告与流程二维码，最后只清理其临时验证记录。

本次业务数据备份：`/var/backups/rehab/rehab-20261021-120220.tar.gz`；旧程序和 Caddy 配置：`/root/rehab-release-20261021-120220`。发布后已确认 3 个账号保留，四张患者业务表均为 0，生成 PDF 目录为空；固定入院流程 PDF 保留。发布校验通过登录、保存/搜索/详情、账号隔离、住院号及流程去重、三类二维码的 IP 链接、匿名 PDF 下载，临时验证记录已删除。

更新前先备份。H5 只上传编译后的 `unpackage/dist/build/web` 到 `public`，不要上传源码目录或 `.env`。

日常仅发布代码可用 `release-code-only.sh <暂存目录>`（暂存目录须位于 `/home/ubuntu/rehab-release-*`，包含 `server` 发布文件及 `deploy/verify-preserved-data.cjs`）。该脚本保留数据库、报告目录、`.env` 和 Caddy 配置，发布前备份并核对业务数据与文件指纹；启动健康检查失败时恢复旧程序。依赖锁文件不一致时会停止，应先安排依赖更新。不要使用带清库操作的 `release-ip-access.sh` 进行普通发版。

后端更新 `index.js`、`discharge-flow.js`、`package.json`、`package-lock.json` 等程序文件，保留线上 `.env`、`storage`。出院流程版本必须同时上传 `discharge-flow.js`，启动时自动创建流程表。使用部署账号上传到暂存目录，再由 sudo 复制到正式目录；程序由 root 持有、rehab 只读，storage 由 rehab 读写。

入院流程版本还需上传 `server/documents/admission-flow.pdf` 到服务器对应的 `documents` 目录。该文件为固定公共指引，二维码访问 `/documents/admission-flow`，此路径及其 `/pdf` 子路径需转发至 Node 服务。更新内容后替换固定 PDF 即可，二维码地址保持不变。详见 `ADMISSION_FLOW.md`。

```bash
sudo systemctl start rehab-backup.service
sudo systemctl stop rehab-web
# 安装经过验证的代码后：
cd /opt/rehab-app/server
sudo npm ci --omit=dev --no-audit --no-fund
sudo node --check index.js
sudo chown -R root:rehab node_modules
sudo chmod -R u=rwX,g=rX,o= node_modules
sudo systemctl start rehab-web
curl -fsS http://127.0.0.1:3000/api/health
```

## 备份与恢复

每日备份包括业务数据库（账号、记录、分享）、PDF 文件、应用 `.env`。为保证 PDF 与数据库一致，备份时短暂停止后端，拷贝完成即恢复。手动执行 `sudo systemctl start rehab-backup.service`。已执行首次备份并核验。

TLS 证书由 Caddy 管理；初次迁移快照另有证书副本。应定期把备份复制到受控的异机存储，仅留在同台机器不能防止整机丢失。备份含患者信息及密钥，禁止放在 public 目录。

恢复前停止写入并备份当前数据，确认恢复版本后，由管理员导入 SQL、恢复 `.env` 和 PDF 目录，修正文件权限并启动服务。不要直接导入历史快照覆盖后来新增的数据。

## 旧服务器退出与回退

待公网访问和业务验证完成、DNS 缓存过渡结束后，再停用旧服务器。

旧机代理切换前配置位于 `C:\rehab-deploy\migration-134-175-42-162\Caddyfile.before-cutover`。恢复此配置只能恢复旧代码和旧数据库入口；如果新服务器已产生新记录，必须先反向同步数据库与 PDF，不能直接切回历史数据。旧服务器的每日备份只包含旧数据；正式业务备份以新服务器为准。

`linux-migrate.sh` 是本次一次性迁移脚本，包含快照校验及防重复导入保护，不用于日常更新。`verify-linux-migration.cjs` 用于管理员执行完整链路验证，会创建唯一标记的临时数据并在 finally 中清理。

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

## 2026-10-29 4位验证码正式部署完成（北京时间20:36）

- 已按用户本次授权，将4位数字字母混合、不区分大小写的预约验证码正式发布到 https://gzitwmkfk.cn。前端输入上限、格式校验、提示和后端生成/验证均为4位，5分钟有效期、换图、提交限流和预约中防重不变。此记录取代上文“4位版本本地待发布”的当前状态，历史记录保留。
- 正式构建：tmp/h5-production-captcha-four-20261029；暂存目录：/home/ubuntu/rehab-release-20261029-captcha-four-1793277317995。
- 本次使用新增deploy/release-captcha-four.sh，先校验完整性和所有未改动后端文件/依赖与线上一致，仅替换reservation-captcha.js和H5 public。不重装依赖，不更改数据库结构，不修改/重建RESERVATION_ID_KEY、原.env或Caddy。失败自动恢复旧验证码模块和public，不回滚业务数据。
- 本地预约全套测试、10个Vue模板和生产构建均通过。线上以实际rehab账号验证4位生成和SVG字体加载；验证4位混合、大小写不敏感、旧6位拒绝、HTTPS新资源、缺验证码不入库、登录保护、预约筛选/人数及数据库防重索引。两个现有有效报告/流程分享及入院PDF/JPEG仍正常；未插入测试患者/预约。
- 本机公网独立验证HTTPS、首页资源、4字符验证码图片（4字形路径+3干扰线）、300秒有效期、no-store和匿名列表401。
- 数据指纹前后复核一致：3个原账号、1条患者记录、1份报告分享、1份出院流程、1条住院号登记及0条预约均保留，业务文件、固定文档、密钥配置和代理配置未变化。
- 程序回退备份：/root/rehab-code-release-20261029-203616-captcha-four（application.tar.gz、旧验证码模块、old-public、preserved-data.json）。发布前完整业务备份：/var/backups/rehab/rehab-20261029-203616.tar.gz；发布后完整备份：/var/backups/rehab/rehab-20261029-203723.tar.gz。所有备份保留在服务器私有目录，没有下载患者资料或密钥。
- 发布后完整备份重启服务并再次检查，本地与域名/api/health均正常，rehab-web/caddy/mariadb/rehab-backup.timer均active，后端与数据库只监听127.0.0.1，NRestarts=0。用户如看到旧6位页面需刷新/重新打开。

## 2026-11-01 复诊须知姓名修正正式部署完成（北京时间20:53）

- 已按用户授权发布到 https://gzitwmkfk.cn：复诊须知“白艳青”修正为“白艳甫”，“邓眉帆”修正为“邓眉敏”。新生成的出院报告使用修正内容，历史PDF未重生成/改写。此记录更新上一节本地未部署状态。
- 本次为纯H5发布，所有后端模块、package.json与package-lock.json和线上逐文件一致，不替换后端/依赖，不修改数据库结构、.env、预约加密密钥或Caddy。
- 新增deploy/release-followup-names.sh：私有备份、暂时停服、保留old-public、替换public、业务数据指纹验证、HTTPS检查和失败回退；新增deploy/verify-followup-names.cjs验证线上正式JS包含两个正确姓名且无旧错别字，不插入测试患者或预约。
- 本地姓名源数据/报告章节引用检查、10个Vue模板、预约全套回归和正式H5构建通过；产物tmp/h5-production-followup-names-20261101；患者页包pages-hzjbxx-index.29945da9.js。
- 暂存目录/home/ubuntu/rehab-release-20261101-followup-names-1793537456520；程序回退目录/root/rehab-code-release-20261101-205328-followup-names（700），含application.tar.gz（600）、old-public及preserved-data.json。完整业务备份/var/backups/rehab/rehab-20261101-205328.tar.gz（600），保留数据库、业务文件和加密配置，未下载至本地。
- 发布前后3个账号、1条患者、1份报告分享、1份出院流程、1条住院号登记、0条预约以及业务PDF/固定文档/配置指纹均一致；两个有效原分享及入院PDF/图片正常。4位验证码、缺验证码拦截、登录保护、预约状态筛选和人数/唯一索引检查继续通过。
- 本机公网独立验证HTTPS首页与静态资源、新JS包中的正确姓名；服务器最终health正常，rehab-web/caddy/mariadb/rehab-backup.timer均active，NRestarts=0。未清理业务数据，未改写历史报告。

## 2026-11-11 预约删除的最小权限与发布检查

历史部署脚本的库级SELECT/INSERT/UPDATE/CREATE/ALTER/INDEX不包含DELETE。上线删除功能时必须额外为实际应用账号授予仅预约表的DELETE，不能通过root测试或编号0的400响应代替。不要扩大到所有表或所有数据库。

现有正式环境已修复；授权前备份与回退位置见CODEX_PROJECT_CONTEXT.md。对新环境应先完成数据库表初始化，然后在服务器以管理员运行deploy/fix-reservation-delete-permission.cjs的inspect模式；确认缺权限后运行apply。工具从服务器.env读取配置，保存私有原授权/回退文件并仅授予预约表权限；以恒假条件和未分配编号验证，无真实预约删除。不要打印.env、密码或原授权文件。

新版deploy/verify-reservation-release.cjs已增加应用数据库账号的DELETE WHERE 1 = 0验证（affectedRows必须为0），发布缺权限即失败。无需调整应用登录权限或将SQL授权扩大给匿名访客。
