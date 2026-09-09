# 静态站点挂载

管理页路径：`/tools/static-sites`，需要 `static-sites` 工具权限。

把写好的纯静态网页（HTML / CSS / JS / 图片 / 字体 / 音视频）放进一个文件夹，上传后即可通过**独立域名**对外访问。一个文件夹就是一个独立站点，互不影响。

## 目录结构

```
data/sites/
  my-portfolio/
    index.html
    assets/app.css
    site.json        ← 站点配置，不会对外提供
  wedding/
    index.html
```

`data/sites/` 是服务器私有运行数据，已在 `.gitignore` 中排除，不会进入版本控制。

## 为什么必须用独立域名

静态站点**只在站点域名上提供服务**，不会挂在 BOX 主站域名下。这是安全要求，不是偏好：

如果站点和 BOX 同源，站点里的 JS 就能发同源请求调用 BOX 的接口，而浏览器会自动带上访客的登录 Cookie，同源校验也会通过——等于任何上传的页面都能以访客身份操作它的 BOX 数据。放到独立域名后，会话 Cookie 不会被发送，同源校验也不会通过。

因此只要有一个站点引用了被投毒的第三方脚本，同源方案就会失守；独立域名从结构上消除了这条路径。

## 配置

在 `.env.local` 中设置：

```dotenv
# 静态站点对外域名，多个用逗号分隔。不设置则整个托管功能关闭。
BOX_SITES_HOST=pages.example.com

# BOX 主站域名。仅当有站点设为「仅登录可见」时必需。
BOX_PRIMARY_HOST=box.example.com
```

把 `pages.example.com` 的 DNS 指向同一台服务器（或同一个隧道），由同一个 Node 进程按 `Host` 请求头分流即可，不需要额外的 Web 服务器。

### 本地开发（还没有服务器时）

不需要域名、不需要改 hosts：把 `localhost` 和 `127.0.0.1` 当作两个不同的源即可。它们的主机名字符串不同，因此浏览器不会把主站的会话 Cookie 发到站点一侧，隔离效果与生产环境一致。

```dotenv
BOX_SITES_HOST=127.0.0.1:9999
BOX_PRIMARY_HOST=localhost:9999
```

- BOX 主站：`http://localhost:9999`
- 静态站点：`http://127.0.0.1:9999/站点名/`

注意两侧要固定用各自的地址访问：在 `127.0.0.1` 上打开 BOX 主站会被当成跨源，管理页的写操作会被同源校验拒绝。

也可以用 `pages.localhost:9999` 这类子域名，但要注意 Windows 的系统解析器默认不认 `*.localhost`（浏览器内部通常会兜底到回环地址）。想稳妥就在 `C:\Windows\System32\drivers\etc\hosts` 加一行 `127.0.0.1 pages.localhost`。

可选的体积上限（均有内置夹取范围）：`BOX_SITES_MAX_FILE_BYTES`（默认 50 MiB）、`BOX_SITES_MAX_ARCHIVE_BYTES`（默认 200 MiB）、`BOX_SITES_MAX_TOTAL_BYTES`（单站点总量，默认 1 GiB）。

## 上传

管理页支持三种方式，可任选：

- **拖入文件夹**：递归读取整个目录树后逐个文件上传。
- **拖入 zip**：上传后由服务端解压。
- **点按钮选择**：「选择文件夹」或「选择 zip」。

「覆盖发布」默认开启，会先清空站内原有文件再写入，适合整站重新发布；关闭则是增量覆盖同名文件。

如果压缩包或所选文件夹只有一个顶层目录，且 `index.html` 在该目录里而不在根下，上传时会**自动去掉这层目录**——直接压缩整个网站文件夹得到的 zip 不会多套一层。

## 站点配置 site.json

每个站点目录下可以有一个 `site.json`，管理页保存配置时会写入它。缺失或内容损坏时一律回落到默认值，不影响站点访问。**该文件不会对外提供**，访问它一律返回 404。

```json
{
  "title": "我的作品集",
  "visibility": "public",
  "spaFallback": false,
  "notFoundPage": "404.html",
  "cacheSeconds": 0
}
```

| 字段 | 说明 |
| --- | --- |
| `title` | 管理页显示名，最长 80 字符 |
| `visibility` | `public` 任何人可访问；`authenticated` 仅登录账户可见 |
| `spaFallback` | 单页应用回退：请求路径没有实体文件且不带扩展名时交给 `index.html` |
| `notFoundPage` | 站内相对路径的自定义 404 页；非法路径会回落到 `404.html` |
| `cacheSeconds` | 浏览器缓存秒数，0 表示改了立即生效；仅登录可见的站点始终不缓存 |

读取配置时所有字段都会做归一化与范围夹取，因此手工上传的 `site.json` 即使写错也不会造成异常配置。

## 访问行为

- 访问地址：`https://<站点域名>/<站点名>/`
- 路径解析顺序与常见静态服务器一致：精确文件 → 同名 `.html` → 目录下 `index.html`
- 少了结尾斜杠时会 301 重定向补上，避免页面里的相对路径解析到上一层
- 站点域名**不提供索引页**：根路径与不存在的站点都只返回 404，不暴露已挂载的站点清单
- 只接受 `GET` 与 `HEAD`
- 所有响应带 `X-Content-Type-Options: nosniff`
- 文本类资源按需 gzip；音视频等支持 `Range` 分段请求，可以拖动播放进度

## 仅登录可见的站点

会话 Cookie 只属于 BOX 主站域名，不会发送到站点域名，因此需要一次跨源授权握手：

1. 访客访问站点域名上的私有站点，没有访问凭证；
2. 302 跳转到主站 `/api/sites/grant`；
3. 主站校验会话（未登录会先进登录页），签发一枚 **60 秒一次性令牌**，跳回站点域名；
4. 站点域名的 `/__site-auth` 校验令牌，换成本域名下的短期 Cookie（默认 1 小时，`BOX_SITE_ACCESS_TTL_SECONDS` 可调），再跳回原地址。

安全细节：

- `/api/sites/grant` 只允许跳回 `BOX_SITES_HOST` 中列出的域名，防止被当作开放重定向。
- 该端点只要求**登录**，不要求 `static-sites` 管理权限——它服务的是访客，不是管理员。
- 访问凭证过期后会自动重新握手；若浏览器禁用 Cookie，会返回明确的 403 而不是无限重定向。
- 凭证有效期内即使账户权限变更也仍然有效，最长滞后一个 TTL。需要立即断开访问时，把站点改回 `public` 之外或直接删除站点。

## 管理接口

全部需要 `static-sites` 权限，写操作还要求同源请求。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/sites` | 站点列表、域名配置与体积上限 |
| `POST /api/sites` | 新建站点 `{ name, config }` |
| `GET /api/sites/:name` | 单个站点概况 |
| `DELETE /api/sites/:name` | 删除站点及其全部文件 |
| `GET /api/sites/:name/files` | 站内文件列表 |
| `POST /api/sites/:name/files` | 上传单个文件，路径由 `X-Site-File-Path` 头携带，请求体为文件内容 |
| `DELETE /api/sites/:name/files` | 带 `?path=` 删除单个文件，不带则清空全部文件 |
| `POST /api/sites/:name/archive` | 上传 zip 并解压，`?replace=1` 表示先清空 |
| `PUT /api/sites/:name/config` | 更新 `site.json` |
| `GET /api/sites/grant` | 访客授权入口，仅需登录 |

## 安全边界

- 站点名限制为小写字母、数字、`-`、`_`，最长 40 字符，并排除 `api`、`login`、`admin`、`__site-auth` 等保留名。
- 上传路径与 zip 条目走**同一套**校验：拒绝 `..`、绝对路径、盘符、控制字符与非法文件名，解析后的绝对路径必须仍在站点目录内。
- zip 解压前先整体校验全部条目（路径、单文件体积、解压后总量），任何一条不合法就整包拒绝，不会出现「解压一半」的状态；符号链接条目会被跳过，条目数上限 5000。
- 单文件、单压缩包与整站体积三级限额，防止磁盘被写满。

## 备份

`data/sites/` 需要与 `data/box.sqlite` 一起纳入备份。站点文件不在 Git 中，只有数据库的备份无法恢复站点内容。
