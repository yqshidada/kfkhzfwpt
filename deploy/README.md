# 腾讯云 Windows 部署

> 2026-10-13 已迁移到 Ubuntu 服务器 `134.175.42.162`，当前运维请阅读 [LINUX.md](./LINUX.md)。下文保留作为旧服务器部署记录；旧服务器目前仅承担 DNS 过渡转发，原数据库用于回退。

部署日期：2026-10-12；HTTPS 配置日期：2026-10-13。服务器：193.112.28.250，Windows Server 2025。

## 访问与架构

- 网站：https://gzitwmkfk.cn/ 。HTTP、`www.gzitwmkfk.cn` 和原公网 IP 的 HTTP 访问会跳转到该地址。
- H5 使用 hash 路由；接口使用同站点 `/api`，登录后的业务请求携带 `Authorization: Bearer <token>`。
- 每条新生成的出院报告绑定当前登录账号。患者记录列表与详情只返回该账号创建的记录；住院号通过服务端登记表全局去重。
- 上线前遗留的记录没有创建账号信息，默认不在任何账号的列表中展示。需要保留展示时，应由管理员确认归属账号后再迁移，避免错误暴露患者资料。
- Caddy 2.11.7 提供 TCP 80/443 的 HTTP 跳转和 HTTPS 代理，自动申请、续期两个域名的 Let's Encrypt 证书。80 端口需保持开放，供证书续期验证使用。
- Node.js 22 服务同时提供 H5 静态资源和 Express API，仅监听 `127.0.0.1:3000`。服务器 `.env` 中使用 `PORT=3000`、`HOST=127.0.0.1`，无需开放公网 3000 端口。没有使用 IIS。
- MariaDB 11.4 只监听 `127.0.0.1:3306`，不向公网开放。
- 登录账号与随机密码单独保存在本机 `tmp/production-login.json`，不要上传或提交此文件。生产构建的登录页不会预填本地测试密码。
- 未迁移本地患者数据。患者表单暂时保留此前要求的测试默认值，正式录入时请替换为实际填写内容。

## 服务器目录

| 路径 | 用途 |
| --- | --- |
| `C:\rehab-app\server` | 后端代码、依赖和 `.env` |
| `C:\rehab-app\server\public` | 仅此目录向公网提供静态文件 |
| `C:\rehab-app\service` | WinSW 服务程序、配置和备份脚本 |
| `C:\rehab-app\proxy` | Caddy 程序和当前生效的 Caddyfile |
| `C:\rehab-app\proxy\data` | TLS 证书、私钥和自动续期账户数据，仅授权系统账号可访问 |
| `C:\rehab-app\logs` | 服务日志，按大小轮转 |
| `C:\rehab-app\backups` | 每日数据库压缩备份，保留 30 天 |
| `C:\rehab-deploy\secrets` | 数据库及应用初始化凭据，仅管理员和 SYSTEM 可读 |

服务 `RehabWeb`、`RehabProxy` 均以 LocalService 运行，自动延迟启动，异常退出自动重启；`RehabProxy` 依赖 `RehabWeb`，`MariaDB` 自动启动。数据库连接池为 5，Node 堆上限 192 MB，MariaDB 缓冲池 128 MB，Caddy Go 内存软限制 128 MiB。

## 日常检查（服务器管理员 PowerShell）

```powershell
Get-Service RehabWeb,RehabProxy,MariaDB
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod https://gzitwmkfk.cn/api/health
Get-ScheduledTaskInfo -TaskName RehabDailyBackup
Get-ChildItem C:\rehab-app\backups
```

正常健康检查返回 `ok: True`。如修改后端代码或 `.env`，执行：

```powershell
Stop-Service RehabProxy
Restart-Service RehabWeb
Start-Service RehabProxy
Get-Content C:\rehab-app\logs\RehabWeb.err.log -Tail 80
```

实际日志文件名可用 `Get-ChildItem C:\rehab-app\logs` 查看。无需手动运行 `npm start`，否则可能产生端口冲突。

## 更新前端

1. 在 HBuilderX 中将当前项目发行到网站 H5；生产产物目录为 `unpackage/dist/build/web`。
2. 本机 PowerShell 打包并上传：

```powershell
tar.exe -czf tmp/h5-release.tar.gz -C unpackage/dist/build/web .
scp -i C:\Users\Lenovo\.ssh\kfkxcx-tencent-deploy tmp/h5-release.tar.gz Administrator@193.112.28.250:C:/rehab-app/h5-release.tar.gz
```

3. 服务器先备份旧前端，再解压：

```powershell
$releaseBackup = 'C:\rehab-deploy\h5-before-' + (Get-Date -Format yyyyMMdd-HHmmss) + '.zip'
Compress-Archive -Path C:\rehab-app\server\public\* -DestinationPath $releaseBackup
tar.exe -xzf C:\rehab-app\h5-release.tar.gz -C C:\rehab-app\server\public
```

前端无需重启服务，刷新浏览器即可。保留旧的哈希资源可供尚未刷新的页面使用；不要上传整个项目根目录或 `.env`。

## 更新后端

先备份服务器 `index.js`、`package.json`、`package-lock.json`，仅上传这三个代码文件，不覆盖服务器 `.env`。如依赖发生变化，在服务器运行：

```powershell
Set-Location C:\rehab-app\server
Stop-Service RehabProxy
Stop-Service RehabWeb
& 'C:\Program Files\nodejs\npm.cmd' ci --omit=dev --no-audit --no-fund
& 'C:\Program Files\nodejs\node.exe' --check index.js
Start-Service RehabWeb
Start-Service RehabProxy
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

安装或检查失败时先还原备份并恢复依赖，再启动服务。`deploy/Invoke-Server.ps1 -ScriptPath <本地脚本>` 可通过部署 SSH 密钥执行服务器 PowerShell 脚本。

## HTTPS 配置维护

仓库中的 `deploy/Caddyfile` 与服务器 `C:\rehab-app\proxy\Caddyfile` 对应，服务配置参考 `deploy/RehabProxy.xml`。修改代理配置前先备份，在服务器执行：

```powershell
& C:\rehab-app\proxy\caddy.exe validate --config C:\rehab-app\proxy\Caddyfile --adapter caddyfile
& C:\rehab-app\proxy\caddy.exe reload --config C:\rehab-app\proxy\Caddyfile --adapter caddyfile
```

验证失败时不要加载配置。证书自动续期，无需手动替换；需保留正确 DNS 解析、开放的 80/443 端口和证书数据目录。证书私钥不应复制到前端目录、代码仓库或公开共享位置。

## 备份与恢复

计划任务 `RehabDailyBackup` 每天服务器时间 03:00 执行。手动备份：

```powershell
& C:\rehab-app\service\backup.ps1
```

备份包含用户与患者记录；目前只在同一台服务器保存，应另行复制到受控的异地存储。恢复前停止应用并备份当前数据库，在确认恢复目标后将 ZIP 中的 SQL 导入 `rehab_discharge`，再启动应用。不要在未确认的情况下覆盖现有数据库。

## 当前限制

- 已配置三个登录账号，护士只能查看自己创建的记录；尚未实现账号管理、密码重置和分角色权限。
- 修改 `.env` 中初始化密码不会自动修改数据库内已经存在的账号密码。
- PDF 在浏览器生成并下载；移动端能否直接保存取决于浏览器，微信内置浏览器可能需要选择外部浏览器打开。
- 云端需放行入站 TCP 80、443；SSH 22 可限制到管理员来源 IP。后端 3000 和数据库 3306 不应开放到公网。

## 依赖感知的Ubuntu发布（2026-10-29）

本次预约版本已经上线。新增release-with-dependencies.sh、release-support.cjs、verify-reservation-release.cjs：先按锁文件在隔离暂存目录安装依赖，备份后短暂停服，私有生成/保留预约加密密钥，替换程序/H5/依赖树，增量创建预约表，核验原有账号业务内容与文件不变，HTTPS验证后恢复自动备份。旧public与node_modules保留于root私有回退目录。只读验证不插入测试患者或预约。

正式备份/时间/暂存目录与密钥恢复注意见LINUX.md文末。不要使用清库脚本或旧Windows部署脚本进行普通发版；不要用本地.env覆盖线上配置。

### 4位验证码补丁发布（2026-10-29 20:36 北京时间）

已使用release-captcha-four.sh完成正式发布：依赖/未改动模块一致性检查、备份、数据指纹核验、仅替换验证码模块与H5、失败回退、4位专项线上检查。此脚本不修改密钥、数据库结构、依赖或业务文件。最新备份及部署明细见LINUX.md文末。

### 复诊须知姓名修正（2026-11-01）

已通过release-followup-names.sh执行纯H5发布。脚本检查线上后端与本地逐文件一致，仅备份/替换public，保留账号、业务数据、历史PDF、密钥、依赖和代理配置，验证失败回退旧public。verify-followup-names.cjs检查HTTPS服务的正式报告生成包含两个正确姓名，未写入测试患者或预约。备份详情见LINUX.md文末。
