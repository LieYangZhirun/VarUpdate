# VarUpdate

在 SillyTavern **酒馆助手**扩展的脚本 iframe 中运行的 JavaScript 模块，为对话提供基于 Schema / Default / Initial / Update 的结构化变量管理能力（与仓库内 Agents 脚本可通过事件协同，亦可单独使用）。

## 核心能力

- **声明式 Schema** — 用户以 YAML/JSON/TOML 格式编写变量结构声明，编译为运行时 Zod 校验器
- **结构化变量更新** — AI 通过 `<Var_Update>` 标签输出 JSON Patch 指令，引擎自动修正格式偏差并逐条校验
- **多层级变量存储** — 通过酒馆助手 API 在 global / chat / message 三个作用域管理变量生命周期
- **插值宏系统** — 注册 `{{作用域/字段/路径}}` 格式的宏，在消息发送前自动替换为变量值

## 项目结构

```text
VarUpdate/
├── src/
│   ├── index.ts                          # 主控制器（入口、事件编排）
│   ├── modules/
│   │   ├── format-parser.ts              # 模块1：多格式解析器（JSON/TOML/YAML）
│   │   ├── schema-compiler/              # 模块2：Schema 编译器
│   │   │   ├── index.ts                  #   封装层（缓存、通知、文本解析衔接）
│   │   │   └── schema-to-zod.ts          #   核心编译逻辑（类型映射、$defs、约束、refer）
│   │   ├── json-patch/                   # 模块3：JSON Patch 引擎
│   │   │   ├── index.ts                  #   三层管道入口
│   │   │   ├── flexible-json-patch.ts    #   指令预处理（文本清洗→引号修正→宽松解析→语义规范化）
│   │   │   ├── path-resolver.ts          #   反向路径解析（模糊匹配）
│   │   │   └── executor.ts              #   指令执行器（逐条执行+逐条校验+单条回滚）
│   │   ├── variable-store.ts             # 模块4：变量存储适配层
│   │   ├── tag-extractor.ts              # 模块5：消息标签提取器
│   │   ├── macro-engine.ts               # 模块6：插值宏引擎
│   │   ├── event-bus.ts                  # 模块7：事件总线
│   │   ├── notification.ts               # 模块8：通知系统
│   │   ├── ui-panel.ts                   # 模块9：UI 面板
│   │   ├── condition-evaluator.ts        # 模块10：条件求值（世界书/预设名中的 []）
│   │   └── native-filter.ts              # 模块11：原生过滤 Hook
│   ├── shared/
│   │   ├── path-utils.ts                 # 路径工具（parsePath/get/set/deleteByPath）
│   │   ├── promptal-yaml.ts              # PromptalYAML 序列化器
│   │   ├── filter-macro-data-by-schema-hide.ts  # Schema $hide 过滤
│   │   ├── schema-force-primitives.ts    # (force) 类型名集合（与编译器、宏侧共用）
│   │   └── merge-deep-conflict.ts        # 深度合并（冲突检测）
│   └── types/
│       └── index.ts                      # 共享类型定义（含 ScriptError 基类）
├── tests/                                # vitest 测试
├── dist/                                 # esbuild 构建输出
├── 架构设计/                             # 仅本地设计文档（.gitignore，不进远程仓库）
├── esbuild.config.mjs                    # 构建配置
├── tsconfig.json                         # TypeScript 配置
├── vitest.config.ts                      # 测试配置
└── package.json
```

## 模块架构

```text
                   ┌──────────────────┐
                   │   主控制器        │
                   │   (index.ts)     │
                   └──────┬───────────┘
                          │ 调度所有模块
          ┌───────────────┼───────────────────┐
          ▼               ▼                   ▼
   ┌─────────────┐ ┌─────────────┐    ┌──────────────┐
   │ 5.标签提取器 │ │ 9.UI 面板   │    │ 8.通知系统    │
   └──────┬──────┘ └─────────────┘    └──────────────┘
          │ 提取标签内容                       ▲
          ▼                                   │ 所有模块均可调用
   ┌─────────────┐                            │
   │ 1.格式解析器 │◄─── Schema/Default/Initial 的文本输入
   └──────┬──────┘
          │ JSON 对象
     ┌────┴────┐
     ▼         ▼
┌─────────┐ ┌──────────┐
│ 2.Schema │ │ 3.Patch  │
│  编译器  │ │  引擎    │
└────┬────┘ └────┬─────┘
     │Zod对象    │ 校验后数据
     ▼           ▼
   ┌─────────────────┐
   │ 4.变量存储适配层  │◄──► 酒馆助手变量系统
   └────────┬────────┘
            │ 变量值
       ┌────┴────┐
       ▼         ▼
┌──────────┐ ┌──────────┐
│ 6.插值宏  │ │ 7.事件   │
│  引擎    │ │  总线    │
└──────────┘ └──────────┘
```

## 构建与开发

```bash
# 安装依赖
npm install

# 开发构建（含 sourcemap，不压缩）
npm run dev

# 生产构建（压缩，无 sourcemap）
npm run build

# 运行测试
npm test

# 监听模式测试
npm run test:watch

# 仅 TypeScript 类型检查（不写 dist）
npm run typecheck
```

## 技术栈

- **语言**：TypeScript → esbuild 打包为单文件 ESM
- **运行时**：SillyTavern iframe（浏览器环境，ES2020）
- **核心依赖**：运行时 Zod 使用 iframe 全局 `z`（源码不 `import 'zod'`；`zod` 仅作 devDependency 供类型检查）；js-yaml 以全局 `YAML` 为主；`smol-toml`、`klona`、`json5` 打入 bundle
- **测试**：vitest

## 错误处理

所有自定义错误类继承统一基类 `ScriptError`：

| 错误类                | 所属模块              | 场景                            |
| --------------------- | --------------------- | ------------------------------- |
| `FormatParseError`    | 模块1 格式解析器      | YAML/JSON/TOML 均无法解析       |
| `SchemaCompileError`  | 模块2 Schema 编译器   | Schema 编译失败                 |
| `PatchParseError`     | 模块3 JSON Patch 引擎 | Patch 指令文本解析失败          |

## 跨脚本协作

VarUpdate 可通过事件总线与 Agents 脚本协作：

- Agents → VarUpdate：`agents:message_complete` 传递 AI 生成的消息内容
- VarUpdate → Agents：`varupdate:updated` / `varupdate:update_failed` 反馈变量更新结果
- Agents → VarUpdate：`varupdate:retry_requested` 通知回退变量状态

VarUpdate 亦可独立运行，通过酒馆原生 `MESSAGE_RECEIVED` 事件接收消息。