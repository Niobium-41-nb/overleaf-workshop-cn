# 逆向与补丁记录（PATCH-NOTES）

对象：`iamhyc.overleaf-workshop@0.15.10`（VS Code Marketplace 安装产物）
目标：默认服务器 `https://www.overleaf.com` → `https://cn.overleaf.com`
产物：`iamhyc.overleaf-workshop@0.15.11` + `overleaf-workshop-cn-0.15.11.vsix` + 本文档

## 1. 逆向过程

扩展被市场安装到 `%USERPROFILE%\.vscode\extensions\iamhyc.overleaf-workshop-0.15.10\`。
它没有被混淆或 bundle：`out/` 下是 `tsc` 逐文件编译的 CommonJS（27 个 `.js`，无 `.map`、无 `src/`），
所以可以从 `package.json` 的 `main: ./out/extension.js` 顺着 require 关系定位全部逻辑。

定位“官方站点”引用的方式是对整棵树做全文检索（排除 `node_modules`）：

| 命中位置 | 性质 |
| --- | --- |
| `out/utils/globalStateManager.js:20` `new URL('https://www.overleaf.com')` | **默认主机种子**（真正要实现的目标） |
| `out/core/projectManagerProvider.js:232` `server.name === 'www.overleaf.com'` | **登录方式特判**：官方站点不给密码登录 |
| `out/core/projectManagerProvider.js:164` + `l10n/bundle.l10n.json:51` | 新增服务器输入框的示例文案 |
| `README.md:17/49` | 文档示例（第 84 行是 Overleaf 官方 logo 授权页链接，属外部资源，不改） |

`out/` 里其余 `http(s)://` 常量只有 GitHub / LaTeX-Workshop 的注释性链接，与运行时主机无关。
API 层（`out/api/base.js`）不写死主机，全部由 `new BaseAPI(persist.url)` 的 `this.url` 派生
（`this.url + 'login'`、`new URL(this.url).origin` 供 socket.io 用），因此只改默认种子即可整体转向。
`node_modules` 内部也没有 `overleaf.com` 命中（`socket.io-client` 等不写死主机）。

## 2. 改动清单

共 5 个文件：3 处行为改动 + 文案/版本。
未经改动的文件与原始安装逐字节一致（已用 SHA-256 全树比对，见 §4.3）。

### 2.1 `out/utils/globalStateManager.js` — 默认主机 + 一次性迁移

```js
// 新增：默认主机常量，替代原来的字面量
const DEFAULT_SERVER_ORIGIN = 'https://cn.overleaf.com';
const DEFAULT_SERVER_HOST = new URL(DEFAULT_SERVER_ORIGIN).host;
// 新增：用户显式删除默认主机后的标记
const keyDefaultServerRemoved = 'overleaf-default-server-removed';
// 新增：上游旧版种子主机
const LEGACY_DEFAULT_SERVER_HOST = 'www.overleaf.com';

static getServers(context) {
    const persists = context.globalState.get(keyServerPersists, {});
    this.migrateLegacyDefaultServer(context, persists);   // ← 新增
    if (this.ensureDefaultServer(context, persists)) {    // ← 新增（补种默认主机）
        return this.getServers(context);
    }
    return Object.values(persists).map(...);
}
```

`addServer(context, url.host, url.href)` 保持原样：主机名（`cn.overleaf.com`）既是持久化键，
也是 `overleaf-workshop://<host>/...` 这类远程 URI 的 authority（`remoteFileSystemProvider.parseUri`
直接取 `uri.authority` 当服务器名）。`url.href` 的结尾斜杠必须保留，否则 `BaseAPI` 拼出的
`this.url + 'login'` 会变成 `https://cn.overleaf.comlogin`。`tools/verify.cjs` 对这条有专门断言。

两个新增步骤各管一种升级场景：

```js
// (a) 从未登录过的孤立旧默认项：直接改写成 cn（避免留下一个无用的 www 条目）
static migrateLegacyDefaultServer(context, persists) {
    const legacy = persists[LEGACY_DEFAULT_SERVER_HOST];
    if (legacy === undefined || legacy.login !== undefined) return false;
    if (Object.keys(persists).length !== 1) return false;
    const url = new URL(DEFAULT_SERVER_ORIGIN);
    if (url.host === LEGACY_DEFAULT_SERVER_HOST) return false;
    delete persists[LEGACY_DEFAULT_SERVER_HOST];
    persists[url.host] = { name: url.host, url: url.href };
    context.globalState.update(keyServerPersists, persists);
    return true;
}

// (b) 其它情况（已有登录态的 www、或用户自建了多个主机）：补种 cn，绝不动已有条目
static ensureDefaultServer(context, persists) {
    if (persists[DEFAULT_SERVER_HOST] !== undefined) return false;   // 已存在
    if (context.globalState.get(keyDefaultServerRemoved, false) === true) return false; // 用户删过
    const url = new URL(DEFAULT_SERVER_ORIGIN);
    return this.addServer(context, url.host, url.href);
}
```

`removeServer()` 里补一行：删除的若是内置默认主机，就记录 `keyDefaultServerRemoved = true`，
这样 `ensureDefaultServer()` 不会在下次刷新时把它“复活”，用户的删除意图得到尊重。

设计取舍：登录态是**按主机绑定**的（`server.login.identity.cookies` 与项目列表缓存在同一个键下），
不同域名的 cookie 不能互换。因此：

- 已登录 `www.overleaf.com` 的用户（升级场景里很常见，通常还缓存着若干项目）→ **保留原条目与其登录态**，
  另外补一个未登录的 `cn.overleaf.com`。旧会话不失效，新主机可直接登录，两个站点都能用。
- 如果粗暴地把已登录条目改名成 cn，等于把 www 的 cookie 发给 cn，项目缓存也会错位——这一点被明确排除。
- 只有“唯一主机 = www 且从未登录”的空默认条目才原地改写为 cn，避免升级后留下一个无用的 www。

### 2.2 `out/core/projectManagerProvider.js` — 登录方式判定

```js
// 新增：验证码/SSO 站点，不提供密码登录
const captchaOnlyHosts = ['www.overleaf.com', 'cn.overleaf.com'];
function requiresCookieLogin(host) { return captchaOnlyHosts.includes(host); }

// loginServer() 内，替换原来的单个主机特判
// -   //NOTE: temporarily disable password-based login for `www.overleaf.com`
// -   if (server.name === 'www.overleaf.com') {
// +   if (requiresCookieLogin(server.name)) {
        delete loginMethods['Login with Password'];
    }
```

为什么非改不可：默认主机换成 cn 后，用户第一次右键登录会看到两个选项，而 “Login with Password”
在 cn 上必然失败（见 §3 取证），表现就是“扩展坏了”。上游对 www 禁用密码登录正是同一原因，
把 cn 一并纳入该集合是与上游一致的最小改法。

### 2.3 文案与版本

- `out/core/projectManagerProvider.js:170` 与 `l10n/bundle.l10n.json:51`
  —— 输入框占位示例改为 `Overleaf server address, e.g. "https://cn.overleaf.com"`。
  两处文案必须逐字符一致（`vscode.l10n.t()` 用源文案作键），`tools/verify.cjs` 会校验键存在且调用点匹配。
- `README.md` —— 顶部加 “CN build” 说明块；第 17/49 行示例 URL 改 cn；保留第 84 行 logo 授权链接。
- `package.json` —— `version: 0.15.10 → 0.15.11`。`name`/`publisher` 保持 `iamhyc.overleaf-workshop`，
  以便正常覆盖安装同一扩展 ID。

## 3. 取证：cn 与 www 是同一套 Overleaf，且同样有验证码

`tools/probe-login-compare.mjs` 对比两站 `/login`（只 GET，不发凭据）：

| 观测点 | cn.overleaf.com | www.overleaf.com |
| --- | --- | --- |
| 登录表单 | `<form name="loginForm" captcha-action-name="login" data-ciam-form data-ol-async-form action="/login" method="POST" captcha="">` | 同上 |
| 验证码 | `g-recaptcha`（invisible，`recaptcha.net`），sitekey `6LebiTwUAAAAAMuPyjA4pDA4jxPxPe2K9_ndL74Q` | 同 sitekey |
| SSO 入口 | `/sso-login`（页面文案“工作/高校账户 单点登录”） | `/sso-login`（“Work/university single sign-on”） |
| 会话 Cookie | `overleaf_session2` | `overleaf_session2` |
| 未登录访问 `/project` | `302 → /login?` | 同 |

`tools/probe-cn.mjs` 另确认：`cn.overleaf.com/` 与 `/login` 均 200，返回同款 `overleaf_session2`
会话 cookie 与 `_csrf` 隐藏域。

结论：cn 是同一套 Overleaf 应用（本地化文案 + 同一验证码配置）。扩展的 cookie 登录链路
（`GET /login` 取 `_csrf` → `GET /project` 抓 `ol-user_id` / `ol-csrfToken`）在两站完全相同；
而密码登录需要浏览器里的 reCAPTCHA token，扩展的 `passportLogin()` 并不携带。

直接验证“密码登录在 cn 上不可用”：`tools/probe-password-login.cjs` 用扩展自己的
`BaseAPI.passportLogin()` 发一次 POST（随机不存在的邮箱 `...@example.invalid`，不涉及任何真实账号）：

```
{"type":"error","message":"400: {\"errorReason\":\"cannot_verify_user_not_robot\",
 \"message\":{\"text\":\"抱歉，您没有通过‘我不是个机器人’验证，请检查您的防火墙或网页插件是否阻碍了您的验证。\"}}"}
```

即服务端在验密码之前就要求验证码 token。因此把 cn 与 www 一并排除密码登录，是唯一可行的行为
（否则用户只会看到“Login failed.”）。

## 4. 验证

### 4.1 模块级行为验证（`tools/verify.cjs`）

用最小 `vscode` 替身（`tools/vscode-stub/vscode.js`）直接 require 补丁后的**真实编译产物**，
不复制业务逻辑。对安装后的 `...\iamhyc.overleaf-workshop-0.15.11` 运行结果（15/15 通过）：

```
PASS  fresh install seeds exactly one server -> {"name":"cn.overleaf.com","url":"https://cn.overleaf.com/","apiUrl":"https://cn.overleaf.com/"}
PASS  default server host is cn.overleaf.com -> "https://cn.overleaf.com/"
PASS  persisted server keeps trailing slash required by BaseAPI -> "ok"
PASS  legacy never-logged-in www entry is retargeted to cn -> ["cn.overleaf.com"]
PASS  legacy www entry WITH login keeps its session and gains the CN default -> ["cn.overleaf.com","www.overleaf.com"]
PASS  multi-server setups keep their hosts and gain the CN default -> ["cn.overleaf.com","overleaf.example.edu","www.overleaf.com"]
PASS  an explicitly removed default host is not re-seeded -> "stays removed"
PASS  removing every server re-seeds the CN default -> "cn.overleaf.com"
PASS  real persisted state: CN seeded, existing session untouched -> {"before":["www.overleaf.com"],"after":["cn.overleaf.com","www.overleaf.com"]}
PASS  cn.overleaf.com offers cookies login only (captcha-protected host) -> ["Login with Cookies"]
PASS  www.overleaf.com keeps its previous behaviour (cookies only) -> ["Login with Cookies"]
PASS  self-hosted server still offers password login -> ["Login with Password","Login with Cookies"]
PASS  server-address l10n key resolves to the CN example -> "ok"
PASS  every compiled module loads -> "27 modules"
PASS  BaseAPI.getCsrfToken() against cn.overleaf.com -> csrf=Hf7uwvSN-Tom..., cookie=overleaf_session2
```

其中 `real persisted state` 一项读取本地 VS Code 的 `state.vscdb`（只读，只取主机名/是否已登录，
不打印 cookie），把真实持久化数据喂给 `getServers()`，确认“保留 www 登录态 + 补种 cn”在真实数据上成立。
没有该数据库时该项自动跳过。

基线对照：同一脚本跑原始 0.15.10 时，与 CN 相关的 4 项如预期失败（默认主机仍是 www、cn 不给禁密码登录、
不迁移），证明脚本测的是真实行为差异，而不是恒真断言。

### 4.2 真实站点往返

最后一项 `--network` 用扩展自己的 `BaseAPI.getCsrfToken()`（`undici` + 正则解析）真实请求
`https://cn.overleaf.com/login`，成功取到 `_csrf` 与 `overleaf_session2`，即 cookie 登录的前置步骤在 cn 上可用。

### 4.3 补丁可重放性

- `patches/overleaf-workshop-cn-default-host.patch` 在干净 0.15.10 副本上 `git apply --check` / `apply` 均返回 0；
  应用后与 `extension/` 做全树 SHA-256 比对：**0 个字节差异**（1061 个文件）。
  补丁需以 `git -c core.autocrlf=false apply` 应用，否则 Windows 的 autocrlf 会把新行写成 CRLF
  （内容等价，但不再是逐字节一致）。
- 由 `extension/` 打出的 VSIX 解包后再跑 `verify.cjs` 全部通过，确保“测的就是装的那个”。

### 4.4 安装验证

```
code --install-extension .\overleaf-workshop-cn-0.15.11.vsix --force   # successfully installed
code --list-extensions --show-versions                                 # iamhyc.overleaf-workshop@0.15.11
```

`extensions.json` 中该 ID 的 `location` 指向 `iamhyc.overleaf-workshop-0.15.11`；同 ID 升级安装会替换旧目录。

未覆盖：VS Code 界面内的点击级自动化（需要 Electron 驱动）。已验证的是扩展宿主会执行的同一批模块，
以及真实站点的网络往返。

## 5. VSIX 打包方式

`vsce` 不可用：`package.json` 的 `vscode:prepublish` 会执行 `tsc` + chat-view 构建，而安装产物里没有 `src/`。
因此 `tools/build-vsix.ps1` 手工构造合规 VSIX：

1. 复制 `extension/` 到 `build/vsix/extension/`，剥掉 VS Code 安装时写入的 `__metadata` 块；
2. 写入 `extension.vsixmanifest`（`Identity` 用 `publisher.name` + 新版本，`Engine` 沿用 `^1.80.0`，
   Assets 指向 package.json / README / CHANGELOG / LICENSE / icon）；
3. 写入 `[Content_Types].xml`；
4. 用 `System.IO.Compression.ZipArchive` 逐条写入，条目名统一为正斜杠
   （`ZipFile.CreateFromDirectory` 在 Windows 上可能留下反斜杠，VS Code 解包会错），
   并断言清单 / 内容类型 / package.json 存在。

产物 `overleaf-workshop-cn-0.15.11.vsix`：5.5 MB / 1063 条目（源树 1061 个文件、约 18.9 MB）。
清单由脚本手工生成（`Identity` 取自 `package.json`），因此不依赖 `vsce` 或上游的构建脚本。

## 6. 风险与后续

- 改的是编译产物；上游发新版本后需重新定位这几处（`DEFAULT_SERVER_ORIGIN`、`migrateLegacyDefaultServer`、
  `ensureDefaultServer` + `keyDefaultServerRemoved`、`captchaOnlyHosts`、l10n 示例、版本号）。
- 若上游后续把官方站点列表抽成配置（例如 `const OFFICIAL_HOSTS`），补丁应改成 `push('cn.overleaf.com')` 的单点修改。
- 版本号抬到 0.15.11：可被市场更高版本自动更新覆盖；不希望被覆盖可在 VS Code 中关闭该扩展的自动更新。
- `cn.overleaf.com` 与 `www.overleaf.com` 的账号体系是否互通取决于 Overleaf 侧策略，本补丁不做任何账号/会话迁移。
