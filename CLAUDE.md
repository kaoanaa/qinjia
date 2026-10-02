# CLAUDE.md — 完美亲家（父母代子女相亲微信小程序）

## 项目是什么

家长代子女相亲平台小程序：代理人（父/母/本人）建档 → 家长间沟通筛选 → 付费/额度解锁 → 交换联系方式转线下。目标用户 45–65 岁，**所有 UI 按中老年适配**。

## 唯一需求来源

根目录文件 `# 完美亲家 · 父母代子女相亲微信小程序 PRD（最终整合版 v1.0）` 是**唯一需求真源**。任何与本文件或 docs/ 计划冲突的，以 PRD 为准；PRD 决策记录 D1–D12 是已定稿事项，不得重新讨论或"优化"。

## 文档索引

| 文件 | 用途 | 何时读 |
|---|---|---|
| PRD（根目录） | 需求、规则、验收用例、配置项清单 | 实现任何功能前 |
| docs/PLAN.md | 施工计划：18 个 Step、依赖图、全局不变量 | 每个任务开始时定位当前 Step |
| docs/ARCHITECTURE.md | 技术方案：目录、关键机制实现、定时任务、测试策略 | 写代码前 |
| docs/openapi.yaml | 接口契约（Step 2 产出） | 前后端联调 |
| docs/PAGES.md | 页面树与组件清单（Step 3 产出） | 前端开发 |

## 技术栈（已定稿，勿换）

- 小程序：uni-app（Vue3 + TS + Vite），`apps/miniapp`
- 后端：NestJS 10 + Prisma + MySQL 8 + Redis，`apps/server`（单体强模块化，模块间禁跨表直查）
- 管理后台：Vite + Vue3 + Element Plus，`apps/admin`
- 共享类型/枚举：`packages/shared`
- IM：腾讯云IM（SS 模式，权限走服务端 REST 回调校验）
- 外部依赖一律 interface + mock（支付/IM/OCR/人脸/短信），CI 无外网可跑
- 包管理 pnpm workspace；TS strict；ESLint + Prettier

## 红线（违反任何一条 = 打回，无例外）

1. **禁止硬编码**：所有金额/时长/额度/权重/话术必须读 `reward_config` / `ops_slot`（PRD §11 全清单）。
2. **扣额度必须行锁事务**：按 PRD §6.1 原样 SQL（`SELECT ... FOR UPDATE` + 事务），测试必须跑真实 MySQL，禁止 mock 数据库测扣减。
3. **解锁前服务端拦截一切明文联系方式**：权限判断只在服务端（IM 回调、详情接口、照片 URL），前端隐藏不算数。
4. **单身承诺书校验服务端不可绕过**；婚姻证明可为 NULL 但"未核验"的警示/二次确认逻辑不可省。
5. **敏感信息合规**：身份证/人脸/婚姻证明处理需单独同意留痕；子女授权 consent_record 不可缺；注销需真删除/匿名化（PIPL）。
6. **中老年适配 UI**：字号 ≥16pt、高对比、层级 ≤3、关键操作二次确认且文案口语化。
7. 资金相关模块（quota/unlock/order）测试覆盖行覆盖 ≥90%。

## 工作方式

- **契约先行**：新接口/新表先改 openapi.yaml / schema.prisma，再写实现；前后端凭契约并行。
- **按 PLAN.md 的 Step 顺序执行**，Step 的 Exit 标准未验证通过不开下一个 Step；外部服务异常时先诊断再换路，不复读同一失败命令。
- 每次改动后跑：`pnpm -r build` + 受影响模块测试。
- 涉及 PRD §10 十五条验收用例的改动，改完必须运行对应用例的集成测试。
- 业务规则不明确时：**先查 PRD 对应章节（引用章节号），PRD 没写的问用户，禁止自行发明规则**。

## 常用命令

```bash
pnpm dev:server        # NestJS 开发服务（先 docker-compose up -d 起 MySQL/Redis）
pnpm dev:miniapp       # 小程序 H5 预览
pnpm dev:admin         # 管理后台
pnpm -r build          # 全量构建
pnpm --filter server test          # 后端测试
pnpm --filter server prisma:migrate
```

（命令在对应 Step 脚手架落地后生效；新增脚本时同步更新本节。）
