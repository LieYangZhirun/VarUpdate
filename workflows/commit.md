---
description: VarUpdate 提交流程与故障排查：测试 → 构建 → 提交 → 推送 → CDN 处理
---

# VarUpdate 提交流程与 CDN 故障排查

当用户要求提交代码时，请按以下顺序执行完整的自动化流，并在需要时进行 CDN 排查。

// turbo-all

## 1. 常规提交流程

1. **TypeScript 类型检查**
```bash
npm run typecheck
```
确认无类型错误。

2. **运行测试**
```bash
npm test
```
确认所有测试通过。如有失败，先修复再继续。

3. **更新版本号和使用指南**
修改 `src/version.ts` 和 `package.json` 中的版本号。如果有功能更新，还需要对 `src/ui-panel.ts` 中的相关描述进行修改。

4. **构建 bundle**
```bash
npm run build
```
生成 `dist/bundle.js`。

5. **暂存并提交**
```bash
git add .
git commit -m "<commit message>"
```
提交信息使用 conventional commits 格式。确保 `dist/bundle.js` 包含在提交中。

6. **推送到远程**
```bash
git push
```

## 2. CDN 刷新机制 (jsDelivr)

代码推送到 `main` 分支后，GitHub Actions 会自动触发对应的 `.github/workflows` 进行 jsDelivr CDN 缓存清理（Purge）。
但 jsDelivr 有时会因为底层 Cloudflare 的边缘节点队列阻塞，导致缓存“穿透失败”（即只清理了中心，没清理到离用户最近的节点）。

**静默更新的哲学说明：**
系统默认采用 `@main` 分支链接以支持静默更新。这意味着用户不需要在酒馆中手动更新脚本代码，开发者推送后 10分钟～24小时内全球各地的节点会自动刷新。这同时提供了一段“缓冲期”，万一出现致命错误可以及时撤回。

### 🚨 当你需要“立刻排查” CDN 是否更新时：

**步骤一：抓取边缘节点实际状态**
通过执行 `curl -sS -I` 查询请求头，来判断 CDN 是否命中了陈旧的缓存。
```bash
curl -sS -I "https://cdn.jsdelivr.net/gh/LieYangZhirun/VarUpdate@main/dist/bundle.js"
```

重点看以下两个 Header 参数：
1. **`cf-cache-status`**:
   - `HIT`：遭遇缓存。代表请求没有到达 GitHub，直接由就近的边缘节点返回。
   - `MISS`：没有缓存。代表该节点被迫回源并拿到了最新版本。
2. **`Age`**:
   - 显示边缘缓存已经存活的秒数。如果你刚 push，而 `Age: 40860`（11小时），就证明 purge 并没在当前节点生效！

**步骤二：手动强刷 (如果你等不及)**
如果发现一直 HIT 且 Age 很大，可以手动重发 purge 请求催促 Cloudflare：
```bash
curl -fsS "https://purge.jsdelivr.net/gh/LieYangZhirun/VarUpdate@main/dist/bundle.js"
```
（注：此接口有5分钟限频，需耐心等待生效，或再复测一次步骤一的 Headers）

### 🚑 救火破冰方案（如何绕过被卡的缓存进行测试？）

当你在进行非常紧急的调试，而 CDN 死死卡住不刷新时，不要枯等，可以使用以下方案。**在解决日常问题时，不需要让用户在酒馆改链接（等 CDN 自然老化即可）。但开发者测试时可用：**

**破冰法（骗过 CDN）**：
在原本的 URL 后面随意加一个无意义的参数。CDN 会认为这是一个全新资源从而百分百回源拉取最新代码。
```javascript
// 在酒馆控制台/拓展中使用
import 'https://cdn.jsdelivr.net/gh/LieYangZhirun/VarUpdate@main/dist/bundle.js?v=紧急刷新版';
```
