---
description: VarUpdate 提交流程：测试 → 构建 → 提交 → 推送 → CDN purge
---

# VarUpdate 提交流程

当用户要求提交代码时，按以下顺序执行：

// turbo-all

1. **TypeScript 类型检查**
```
npm run typecheck
```
确认无类型错误。

2. **运行测试**
```
npm test
```
确认所有测试通过。如有失败，先修复再继续。

3. **更新版本号和使用指南**

修改`version.ts`，如果有功能更新还需要对`ui-panel.ts`中的相关描述进行修改

4. **构建 bundle**
```
npm run build
```
生成 `dist/bundle.js`。

5. **暂存并提交**
```
git add .
git commit -m "<commit message>"
```
提交信息使用 conventional commits 格式。确保 `dist/bundle.js` 包含在提交中。

6. **推送到远程**
```
git push
```

7. **Purge jsDelivr CDN 缓存**

push 到 `main` 后，GitHub Actions 会自动触发 `.github/workflows/sync-jsdelivr.yml` 工作流来 purge CDN。

如果用户要求立即 purge 或需要确认，可以手动执行：
```
curl -fsS "https://purge.jsdelivr.net/gh/LieYangZhirun/VarUpdate@main/dist/bundle.js"
curl -fsS "https://purge.jsdelivr.net/gh/LieYangZhirun/VarUpdate@refs/heads/main/dist/bundle.js"
```
注意：jsDelivr purge 有频率限制（约 5 分钟冷却）。通常依赖自动工作流即可，无需手动 purge。