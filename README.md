# 拾番 · 私藏的动画记忆

单人使用的响应式动画日记。React + TypeScript + FastAPI + SQLite，提供 Docker Compose 部署。

## 已实现

- Bangumi 动画名称、ID、链接搜索，详情与本地封面缓存、制作资料、个人资料修订；手动作品可关联 Bangumi。
- 五种观看状态、可选进度、每次重看独立记录；日期精确到日、月、年或未知，不推断具体日期。
- Markdown 感想、图片、台词、单集记录、补记和剧透折叠；本机草稿恢复。
- 时间线、那年今日、观看月份/评分/标签/作品类型/播出年份图表，区分作品数与完成次数。
- 自定义片单、介绍、排序、个人标签及筛选。
- 时间线、年度、单作品 PNG 分享：预览后下载，按八条记录拆图，可选署名、评分、私人感想、剧透内容。
- 多模型配置、按任务记住模型选择、自定义提示词与恢复默认、翻译、感想整理、智能筛选、年度总结和推荐。
- 收藏导入预览、冲突选择、幂等导入；不向 Bangumi 写回。不把收藏更新时间用作完成时间。
- JSON/CSV/Markdown/完整 ZIP 导出、恢复前备份、每日备份，保留最近七份。
- 密码登录、Argon2、同源写请求校验、HttpOnly Cookie、密钥加密、乐观版本检查。

## Linux / NAS 部署

1. 复制 `.env.example` 为 `.env`，设置自定义的 `ADMIN_PASSWORD`（至少12位）。
2. 为 `MASTER_KEY` 填入 Fernet 密钥，可用以下命令生成：

   ```sh
   docker run --rm python:3.12-slim sh -c 'pip install -q cryptography && python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
   ```

3. 将 `PUBLIC_ORIGIN` 设置为浏览器实际访问的源（协议、域名、端口，不带路径）。本机默认为 `http://localhost:8080`；外网配置 HTTPS 反向代理并设置 `COOKIE_SECURE=true`。
4. 启动：

   ```sh
   docker compose up -d --build
   ```

5. 访问配置的地址，用管理员密码登录。进入“偏好设置”填写 Bangumi Token 与模型配置。

树莓派 ARM64 镜像会先安装 `libatomic1`，再安装 Playwright 浏览器依赖，避免其内置 Node 因缺少 `libatomic.so.1` 无法启动。若使用旧版 Dockerfile 遇到此错误，同步新版文件后重新执行 `sudo docker compose up -d --build` 即可，无需删除数据目录。

数据存于 `./data`。不要删除 `.env` 中的主密钥，否则无法解密现有服务凭据。管理员密码仅在空库首次启动时初始化，修改环境变量不会直接覆盖已存在的账户。

升级前下载 ZIP 备份，再执行 `docker compose up -d --build`。Alembic 在后端启动时执行迁移。需要回退时使用原版本镜像和对应版本的 ZIP 备份；不要直接让旧代码读取新数据库。

## Windows 本地开发

要求 Python 3.12+、Node.js 22+。以下为 PowerShell 命令，在项目根目录执行：

```powershell
python3.13 -m venv --system-site-packages .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd install --prefix frontend --cache .npm-cache
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.browsers"
.venv/Scripts/python.exe -m playwright install chromium
```

后端终端设置环境后启动：

```powershell
$env:ADMIN_PASSWORD = 'your-own-long-password'
$env:MASTER_KEY = & .venv/Scripts/python.exe -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
# 将生成的主密钥自行保存，重启时使用同一个值。
$env:DATA_DIR = "$PWD/data"
$env:PUBLIC_ORIGIN = 'http://localhost:5173'
$env:COOKIE_SECURE = 'false'
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.browsers"
Set-Location backend
../.venv/Scripts/python.exe -m alembic upgrade head
../.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 18764
```

另一个终端执行 `npm.cmd run dev --prefix frontend`，访问 `http://localhost:5173`。如 Vite 端口发生变化，需同步修改后端 `PUBLIC_ORIGIN`。开发代理默认指向 18764，可用 `SHIFAN_BACKEND` 环境变量修改。

## 模型设置

| 服务 | Base URL 示例 | 模型 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | 填写账户可用模型名 |
| DeepSeek | `https://api.deepseek.com/v1` | 填写账户可用模型名 |
| 兼容接口 | 服务商提供的接口前缀，通常以 `/v1` 结尾 | 服务商提供的模型名 |

调用后缀为 `/chat/completions`，使用文本消息，不依赖工具调用或供应商专属 JSON 模式。模型配置可以保存多份；灵感助手为每种任务记住当前浏览器上次使用的配置。提示词支持 `{{text}}`、`{{context}}`，不需要变量也可以直接编写任务指令。

简介原文与接受后的译文分别保存；整理感想另存新条目并保留输入文本。年度总结与推荐生成前说明发送范围，剧透感想默认排除。搜索仅允许白名单筛选条件，推荐 ID 必须来自真实候选列表。

## 测试与验证

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
.venv/Scripts/python.exe scripts/e2e.py
```

端到端脚本使用独立测试数据、临时管理员和本地端口，自动启动及关闭服务。覆盖登录、作品与感想保存、模糊日期、重看、PNG 预览、390px 手机布局和统计图。截图输出到 `docs/desktop.png`、`docs/mobile.png`。

真实只读联调已验证 Bangumi 认证、动画搜索、作品详情和收藏列表返回 HTTP 200。提供的账户当前未返回可供检查的收藏条目，因此收藏字段映射及重复导入另以模拟响应测试。密钥未写入项目。没有提供大模型密钥，因此三种接口的协议兼容性通过模拟测试验证，实际模型调用需在设置中完成连接测试。

当前机器未完成 Docker 容器运行验证；本地 Python、前端生产构建与 Chromium 流程可验证。日志检查用 `docker compose logs --tail=100`，健康检查为 `/api/v1/health`，异步任务失败在界面显示。

本次验证结果：12 项后端测试、3 项前端测试、TypeScript 检查与 Vite 生产构建通过；真实 Chromium 端到端流程通过。当前机器 Docker daemon 未运行，因此未执行容器启动验收。

## 数据与接口

`/api/v1` 提供登录、state、records、bangumi、models、prompts、jobs、statistics、media、export、backup、backups、restore 接口；开发环境可在后端 `/docs` 查看自动接口文档。

SQLite 使用版本化文档表，领域数据由后端校验；`revision` 防止覆盖已被修改的记录。数据库迁移位于 `backend/migrations`。完整 ZIP 只包含日记领域数据和图片，不包含密码、模型配置、提示词或 API Key；恢复不会替换管理员身份和现有服务配置。

本版不包含公开链接、多人注册、完整离线同步、语音转写或原生客户端。智能搜索为自然语言条件提取与本地文字匹配，不包含向量检索。长期备份建议自行同步服务器备份目录到其他存储。
