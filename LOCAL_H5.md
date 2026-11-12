# 本地 H5 调试

当前电脑调试地址：

- H5 页面：http://127.0.0.1:8081/
- 后端健康检查：http://127.0.0.1:3000/api/health
- MariaDB：127.0.0.1:3306

## 下次启动

先打开 HBuilderX，然后在项目目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

也可显式指定 HBuilderX 安装目录：

```powershell
.\scripts\start-local.ps1 -HBuilderXPath '你的 HBuilderX 安装目录'
```

只启动数据库和后端：

```powershell
.\scripts\start-local.ps1 -BackendOnly
```

启动脚本使用 HBuilderX 自带的 Node.js 与 uni-app 编译器，不要求全局安装 Node.js。服务在后台运行，电脑重启后需要重新启动。运行日志保存在 tmp/local-*.log；后端代码变更会自动重启，H5 源码变更会自动重新编译。

如果使用 HBuilderX 菜单运行，选择“运行 → 运行到浏览器”。不要与脚本重复启动 H5；端口被占用时 HBuilderX 可能自动换端口，以控制台地址为准。修改 manifest.json 中的代理配置后，需重新启动原来的 H5 调试任务。

## 配置说明

- manifest.json 的 h5.devServer 使用 8081 端口，将 /api、/documents、/share 转发至本地后端 3000 端口。
- utils/api.js 保留 H5 的 /api 相对路径；不改变生产站点接口地址。
- server/.env 是本机私有配置，不提交；分享地址设为 http://127.0.0.1:3000。
- 数据库程序位于 tmp/mariadb-local，数据库数据位于 tmp/mariadb-data。
- PDF 图片阅读还依赖 Poppler；安装后需要在 server/.env 设置 PDFINFO_PATH、PDFTOPPM_PATH，并重新启动后端。缺失该工具时仍可下载 PDF。
- 这里是新建的本地调试数据库，不包含线上账号和患者数据。默认本地测试账号按 server/README.md 的说明登录。

**不要把整个 tmp 目录当作可随意清空的缓存：其中的 mariadb-data 保存本地调试数据。** 如需清理，先停止服务并备份数据库数据。

当前服务仅监听本机回环地址，手机扫码不能访问。需要手机联调时，应单独配置局域网监听地址、分享地址及防火墙，不要直接使用线上数据库。