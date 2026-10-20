# Overleaf Workshop 国内版（默认连接 cn.overleaf.com）

把 VS Code 扩展 [`iamhyc.overleaf-workshop`](https://marketplace.visualstudio.com/items?itemName=iamhyc.overleaf-workshop)
的默认服务器从 `https://www.overleaf.com` 改为 `https://cn.overleaf.com`，方便国内直连。

> **非官方补丁分支**：本项目不新增功能、不从零实现插件，只对上游 `0.15.10` 的编译产物做 5 个文件的定点修改，
> 再以完整 VSIX 形式重新打包。仓库**不包含上游代码**——构建时自动从 Marketplace 下载官方包并按 SHA-256 校验，
> 然后应用 [`patches/`](patches) 里的补丁。授权为 AGPL-3.0（与上游一致，见 [LICENSE](LICENSE)）。

## 它是什么、不是什么

| | |
|---|---|
| **是** | 上游扩展的一个补丁分支（patched fork），有可复现的构建与验证工具链，产出一个自包含、可独立安装的 VSIX |
| **不是** | 从零开发的独立插件，也不是“叠加在原插件上”的补丁插件（VS Code 没有这种机制） |

它沿用上游扩展 ID（`publisher: iamhyc`、`name: overleaf-workshop`），因此是**替换**市场版而非与其共存；
版本抬到 `0.15.11` 以便识别。市场若发布更高版本，自动更新会把它覆盖回官方版。

## 行为变化（共 3 处）

1. **默认主机** → `https://cn.overleaf.com`（结尾斜杠保留，否则 `BaseAPI` 拼出的 `.../login` 会错）。
2. **默认主机补种 / 迁移**：不动已有主机，只在缺失时补种 `cn.overleaf.com`。
   - 唯一且从未登录过的 `www.overleaf.com` 条目 → 就地改写为 `cn.overleaf.com`，不留冗余。
   - 已登录的 `www.overleaf.com`（含项目缓存）→ 原样保留登录态，另加一个未登录的 `cn.overleaf.com`。
   - 你手动删除 `cn.overleaf.com` 后不会被自动加回。
3. **登录方式**：`cn.overleaf.com` 与 `www.overleaf.com` 一样只提供 **Login with Cookies**，
   密码登录被禁用——两站登录表单都由 invisible reCAPTCHA 保护，扩展的 `passportLogin()` 不带验证码 token，
   服务端会直接返回 `400 cannot_verify_user_not_robot`（实测，见 [PATCH-NOTES.md](PATCH-NOTES.md) §3）。
   自建 Overleaf/ShareLaTeX 站点不受影响，仍可用密码登录。

## 快速开始

Windows / PowerShell，需要 Node.js ≥ 22、Git、`tar`（Windows 10+ 自带 bsdtar）：

```powershell
# 1) 下载官方 0.15.10 包（校验 SHA-256）→ 生成 backup/ 与打完补丁的 extension/
node tools/fetch-upstream.mjs

# 2) 打包成可安装的 VSIX
& .\tools\build-vsix.ps1

# 3) 安装（同一扩展 ID，会覆盖市场版）
code --install-extension .\overleaf-workshop-cn-0.15.11.vsix --force
```

已有官方 VSIX 的话可以离线构建：`node tools/fetch-upstream.mjs --from .\iamhyc.overleaf-workshop-0.15.10.vsix`。

## 登录 cn.overleaf.com

1. 侧边栏 Overleaf → `Hosts` → 右键 `cn.overleaf.com` → **Login to Server** → **Login with Cookies**。
2. 在浏览器登录 `https://cn.overleaf.com` → <kbd>F12</kbd> → Network → 过滤 `/project` →
   复制该请求 Request Headers 里的 `Cookie`（形如 `overleaf_session2=...`）→ 粘贴进输入框。
3. 之后即可展开项目列表、打开项目、编译与实时协作。

## 验证

```powershell
node tools/verify.cjs extension            # 14 项离线检查
node tools/verify.cjs extension --network  # 追加真实请求 cn.overleaf.com 的 CSRF/Cookie 通路检查
```

验证脚本用最小 `vscode` 替身直接 require **补丁后的真实编译产物**（不复制业务逻辑），覆盖：默认主机、
补种/迁移、删除后不复生、登录方式、l10n 文案键一致、27 个模块可加载；若本机存在 VS Code 状态库，
还会用真实持久化数据回归一次。基线对照（跑原始 0.15.10）有 4 项如预期失败，说明断言测的是真实行为差异。

## 仓库结构

```
patches/overleaf-workshop-cn-default-host.patch   对上游 0.15.10 的 unified diff（唯一改动来源）
tools/
  fetch-upstream.mjs                              下载+校验官方包、生成 backup/ 与 extension/
  build-vsix.ps1                                  从 extension/ 手工构造 VSIX（无需 vsce）
  build-patch.cjs                                 由 backup/ 与 extension/ 重新生成补丁
  verify.cjs                                      行为验证（真实 out/*.js + vscode 桩 + 可选联网）
  vscode-stub/vscode.js                           验证用的最小 vscode 模块替身
  inspect-global-state.cjs                        只读查看已保存的主机/登录状态（不打印 cookie）
  probe-cn.mjs, probe-login-compare.mjs           取证：cn 与 www 登录页/接口结构对比
  probe-password-login.cjs                        取证：cn 站密码登录被验证码拦截（一次性、假账号）
.github/workflows/reproduce.yml                   CI：下载→打补丁→验证→打包
LICENSE                                            AGPL-3.0
PATCH-NOTES.md                                     逆向过程、逐处改动、取证与验证记录
```

`extension/`、`backup/`、`upstream/`、`build/`、`*.vsix` 都是生成物，已被 `.gitignore` 排除。

## 再生成补丁（上游改版时）

```powershell
node tools/fetch-upstream.mjs            # 重新拉取并应用当前补丁
# 手工修改 extension/ 里的文件后：
node tools/build-patch.cjs              # 重新生成 patches/*.patch（需 backup/ 与 extension/ 同时存在）
node tools/verify.cjs extension
& .\tools\build-vsix.ps1
```

`patches/*.patch` 应用后与 `extension/` 逐字节一致（1061 个文件、0 差异），这是可复现性检查的一部分。
注意用 `git -c core.autocrlf=false apply`，否则 Windows 的 autocrlf 会让新行变成 CRLF。

## 授权与归属

- 上游项目：[`overleaf-workshop/overleaf-workshop`](https://github.com/overleaf-workshop/overleaf-workshop)（作者 iamhyc 等），
  以 **AGPL-3.0** 发布；本补丁与工具链同样以 AGPL-3.0 发布，版权归各自作者。
- 本仓库不提交、不分发上游二进制；如需对外分发编译产物（例如 GitHub Release 里的 VSIX），
  请自行确保满足 AGPL-3.0 的“对应源码”提供义务（上游源码 + 本仓库补丁）。
- “Overleaf” 及其标识为其各自权利人的商标；本项目与 Overleaf 官方无关，也未获其背书。
- 仅供个人使用便利；用于商业或合规敏感场景前请自行评估。

## 已知限制

- 改的是编译后的 JS，不是 TypeScript 源码；上游升级会覆盖补丁，需要按 [PATCH-NOTES.md](PATCH-NOTES.md) 重新定位改动点。
- 未做 VS Code 界面级点击自动化；验证覆盖到模块级真实代码路径 + 真实站点 API 往返。
- `cn.overleaf.com` 与 `www.overleaf.com` 的账号体系/会话是否互通由 Overleaf 侧决定，本项目不做任何会话迁移。
