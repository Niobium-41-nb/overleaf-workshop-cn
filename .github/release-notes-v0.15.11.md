`iamhyc.overleaf-workshop@0.15.10` → `0.15.11`，默认服务器改为 `https://cn.overleaf.com`。

## 改动

- **默认主机**：`https://cn.overleaf.com`（保留结尾斜杠，保证 `BaseAPI` 拼出的 `.../login` 正确）。
- **补种 / 迁移**：不动已有主机与登录态。
  - 唯一且从未登录过的 `www.overleaf.com` 条目 → 就地改写为 `cn.overleaf.com`；
  - 已登录的 `www.overleaf.com`（含项目缓存）→ 原样保留，另加一个未登录的 `cn.overleaf.com`；
  - 手动删除 `cn.overleaf.com` 后不会被自动加回。
- **登录方式**：`cn.overleaf.com` 与 `www.overleaf.com` 一样只提供 Cookie 登录。两站登录表单均由 invisible reCAPTCHA 保护，
  扩展的密码登录不带验证码 token，服务端返回 `400 cannot_verify_user_not_robot`（见 `PATCH-NOTES.md` §3）。
- 新增服务器输入框示例文案、README 说明、版本号。

## 构建

本仓库**不附带二进制**。需要自行构建（约 1 分钟）：

```powershell
node tools/fetch-upstream.mjs      # 下载官方 0.15.10（SHA-256 校验）并应用补丁
& .\tools\build-vsix.ps1           # 生成 overleaf-workshop-cn-0.15.11.vsix
code --install-extension .\overleaf-workshop-cn-0.15.11.vsix --force
```

## 验证

`node tools/verify.cjs extension` — 14 项离线检查（默认主机、补种/迁移、删除后不复生、登录方式、l10n 键、模块加载）；
加 `--network` 会真实请求 `cn.overleaf.com` 校验 CSRF/Cookie 通路。补丁应用后与构建树逐字节一致（1061 个文件、0 差异）。

## 授权

AGPL-3.0，与上游 [`overleaf-workshop/overleaf-workshop`](https://github.com/overleaf-workshop/overleaf-workshop) 一致。
“Overleaf” 为其各自权利人的商标；本项目非官方，未获其背书。
