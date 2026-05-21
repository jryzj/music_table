# AI Music Generator & Player

一个基于 AI 的音乐生成和播放应用，支持多种音乐风格、自定义参数和可视化效果。

## 功能特性

### 音乐生成

- **多风格选择**：支持 70+ 种音乐风格（电子、流行、古典、民族等）
- **人声类型**：器乐、男声、女声、混合
- **音效设置**：房间、大厅、回声、混响四种音效及强度调节
- **自定义标签**：添加自定义标签引导音乐生成
- **自定义歌词**：输入歌词生成带歌词的音乐
- **时长选择**：30秒至5分钟可选
- **BPM 调节**：可调节每分钟节拍数

### 播放控制

- **双模式播放**：
  - **Auto 模式**：播放缓存音乐的同时生成新音乐
  - **Cache 模式**：仅播放缓存音乐，不生成新音乐
- **随机/顺序播放**：🔀 按钮切换随机播放和从新到旧循环播放
- **进度控制**：拖动进度条跳转播放位置
- **音量调节**：0-100 音量控制

### 缓存管理

- **Browser 模式**：使用 IndexedDB 本地存储
- **Server 模式**：使用服务器存储音乐文件
- **自动清理**：自动删除最老的缓存音乐
- **手动清理**：支持删除特定缓存音乐

### 可视化

- **实时频谱**：音频可视化频谱显示
- **波形显示**：实时音频波形展示

## 技术栈

- **前端**：React 18 + Vite
- **音频**：Tone.js
- **后端代理**：Express.js
- **音乐生成**：ComfyUI API
- **认证**：Auth0（OAuth2.0 / JWT）

## 目录结构

```
release/
├── public/                      # 前端静态文件
│   ├── bg.png                   # 背景图片
│   ├── index.html
│   └── assets/                 # 编译后的资源文件
├── server/                      # 后端服务器
│   ├── server.js                # 主服务器文件
│   ├── package.json             # 服务器依赖
│   ├── config.json              # 配置文件（需创建）
│   └── local_music/             # 音乐存储目录（需创建）
├── example.config.json           # 配置示例
├── README.md                    # 本文件
├── start.sh                     # Linux/Mac 启动脚本
└── start.bat                    # Windows 启动脚本
```

## 部署指南

### 1. Auth0 配置

应用使用 Auth0 进行用户认证。需要先在 [Auth0 Dashboard](https://manage.auth0.com) 中创建应用：

1. 创建 **Single Page Application**（单页应用）
2. 配置 **Allowed Callback URLs** 和 **Allowed Logout URLs**（如 `http://your-domain:55175`）
3. 创建 API，设置 Identifier（如 `https://music-api.your-domain.com`）
4. 在 Machine to Machine Applications 中授权该应用访问 API

### 2. 准备配置文件

复制示例配置文件并修改：

**server/config.json**

```json
{
  "api_url": "https://your-comfyui-api.example.com",
  "token": "your-api-token",
  "cache_mode": "server",
  "port": 55175,
  "auth0_domain": "your-tenant.us.auth0.com",
  "auth0_client_id": "your-client-id",
  "auth0_audience": "https://music-api.your-domain.com",
  "auth0_mgmt_client_id": "your-m2m-client-id",
  "auth0_mgmt_client_secret": "your-m2m-client-secret",
  "admin_emails": ["admin@example.com"]
}
```

### 3. 创建音乐存储目录

```bash
mkdir -p server/local_music
```

### 4. 安装依赖并启动

**Windows:**

```batch
cd server
npm install
npm start
```

或直接运行：

```batch
start.bat
```

**Linux/Mac:**

```bash
cd server
npm install
npm start
```

或：

```bash
chmod +x start.sh
./start.sh
```

### 5. 访问应用

启动后访问：`http://localhost:55175`，使用 Auth0 登录。

## 配置说明

### config.json

| 配置项                    | 说明                    | 示例值                                 |
| ----------------------- | ----------------------- | ----------------------------------- |
| api_url                 | ComfyUI API 地址        | https://api.example.com             |
| token                   | ComfyUI API Token       | your-token-here                     |
| cache_mode              | 缓存模式                  | `server` 或 `browser`                |
| port                    | 服务器端口                | 55175                               |
| auth0_domain            | Auth0 租户域名           | your-tenant.us.auth0.com            |
| auth0_client_id         | Auth0 应用 Client ID    | dtVgHVCdcC5eyS...                   |
| auth0_audience          | Auth0 API 标识符         | https://music-api.your-domain.com   |
| auth0_mgmt_client_id    | Auth0 M2M Client ID    | machine-to-machine 应用的 Client ID  |
| auth0_mgmt_client_secret| Auth0 M2M Client Secret| machine-to-machine 应用的 Client Secret |
| admin_emails            | 管理员邮箱列表            | ["admin@example.com"]               |

### cache_mode 缓存模式

**server 模式**：

- 音乐文件存储在服务器的 `local_music/` 目录
- 适合多设备共享访问
- 需要服务器有足够的存储空间

**browser 模式**：

- 音乐文件存储在浏览器的 IndexedDB
- 适合单用户使用
- 不占用服务器存储空间

## 使用说明

### 登录

首次使用需要登录。点击 **"Login with Auth0"** 按钮，跳转到 Auth0 登录页面。支持邮箱+密码登录、社交账号登录等。登录后自动跳转回应用。

### 生成音乐

1. 选择音乐风格（可多选）
2. 选择人声类型
3. 设置音效和强度
4. （可选）添加自定义标签或歌词
5. 设置时长和 BPM
6. 点击生成按钮开始生成

### 播放

1. **Auto 模式**：会同时播放缓存音乐和生成新音乐
2. **Cache 模式**：仅播放缓存音乐，不生成新音乐
3. 🔀 按钮：切换随机/顺序播放模式

### 缓存管理

1. 点击缓存列表查看所有缓存音乐
2. 可播放列表中的任意音乐
3. 可删除不想保留的音乐
4. 在设置中可调整缓存大小

### 管理面板

路径 `/admin`（需使用管理员账号登录 Auth0）：

- **User Access** — 记录所有用户的登录访问，可搜索和排序
- **Generation Log** — 记录每次音乐生成的详情（风格、人声、标签、歌词、文件名等），可搜索和排序
- **User Management** — 查看和管理 Auth0 用户，支持封禁和删除

任意字段内容过长时，点击文字即可弹出完整内容。

## 开发

### 开发模式

```bash
npm install
npm run dev
```

访问 `http://localhost:5174`

### 构建生产版本

```bash
npm run build
```

输出到 `dist/` 目录。将 `dist/` 内容复制到 `release/public/`。

```bash
cp -r dist/* release/public/
```

## API 接口

| 接口                | 方法   | 说明                    | 认证要求             |
| ----------------- | ---- | --------------------- | ---------------- |
| /api/config       | GET  | 获取服务器配置              | 无 |
| /api/system_stats | GET  | 检查 ComfyUI 服务器状态      | 无 |
| /api/prompt             | POST | 提交音乐生成任务（代理到 ComfyUI）     | 需要 ComfyUI Token |
| /api/log-generation     | POST | 记录音乐生成日志到数据库              | 无需认证              |
| /api/log-access         | POST | 记录用户访问日志到数据库              | 无需认证              |
| /api/history/:id  | GET  | 获取生成历史（代理到 ComfyUI）   | 需要 ComfyUI Token |
| /music-save       | POST | 保存音乐到服务器              | 需要 Auth0 JWT    |
| /music-files      | GET  | 获取音乐文件列表              | 需要 Auth0 JWT    |
| /music/:filename  | GET  | 获取特定音乐文件              | 需要 Auth0 JWT    |
| /stream/*              | GET  | 流式代理接口（代理到 ComfyUI）        | 需要 ComfyUI Token |
| /admin/db/*            | GET  | Admin 数据库查询接口               | 需要 Auth0 JWT + 管理员 |
| /admin/users/*         | GET/DELETE | 用户管理接口               | 需要 Auth0 JWT + 管理员 |

## 故障排除

### 播放没有声音

1. 确保浏览器允许自动播放音频
2. 点击页面任意位置激活 AudioContext
3. 检查音量是否设置为 0

### 缓存列表显示数量与实际不符

可能是 IndexedDB 中的 blob 数据损坏。可在设置中调整缓存大小触发清理。

### Auth0 登录失败

1. 检查 Auth0 Dashboard 中 Allowed Callback URLs 是否包含当前访问地址
2. 确认 API Audience 配置与应用中的 `auth0_audience` 一致
3. 确认应用类型为 **Single Page Application**
4. 在 Machine to Machine Applications 中授权应用访问 API

### 生成失败

1. 检查 ComfyUI API 是否可访问
2. 确认 API Token 配置正确
3. 检查网络连接

## License

Private Project