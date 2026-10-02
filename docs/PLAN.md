# 完美亲家 · 施工计划（Blueprint v1.0）

| 项 | 值 |
|---|---|
| 目标 | 按 PRD v1.0 交付"父母代子女相亲"微信小程序（P0 全量 + P1 全量） |
| 形态 | Direct 模式（无 git 仓库，就地编辑；建议 Step 0 初始化 git 后升级为 PR 模式） |
| 技术栈 | uni-app(Vue3+TS) · NestJS(+Prisma) · MySQL 8 · Redis · OSS(可换) · 腾讯云IM · 微信支付 · Vue3+Element Plus 管理端 |
| 依据 | 根目录 PRD 文件（唯一需求来源，本计划不覆盖 PRD 规则，只拆解执行） |
| 红线 | 见根目录 CLAUDE.md「红线」章节，每个 Step 验收时必须复查 |

## 里程碑总览

| 里程碑 | 范围 | Steps |
|---|---|---|
| M0 契约与地基 | 仓库脚手架、OpenAPI 契约、DDL、页面树 | 1–3 |
| M1 P0 核心链路 | 登录建档 → 实名/授权 → 额度账本 → 解锁 → 推荐 → 聊天 | 4–10 |
| M2 P0 配套 | 消息中心、我的、管理后台、防刷风控 | 11–13 |
| M3 P0 验收 | §10 十五条用例自测 + 测试报告 | 14 |
| M4 P1 增值 | 裂变、优惠券、三大墙、搜索、管家、退款流 | 15–17 |
| M5 P2 占位 | 直播/本地群仅留接口与页面占位，不开发 | 18 |

依赖图（→ 表示必须先完成）：

```
1 → 2, 3
2 → 4..13（所有后端 Step 依赖契约）
3 → 5..13（前端 Step 依赖页面树）
4 → 5 → 6 → 7          # 主链路串行：登录建档 → 认证授权 → 额度 → 解锁
4 → 8                  # 推荐依赖档案数据
6,7 → 9                # IM 依赖解锁状态机
9 → 10                 # 聊天依赖会话
8 → 11                 # 详情/信任分级页依赖推荐
5 → 12                 # 后台审核依赖档案模型
6,7 → 12               # 后台额度账本/订单依赖账本与解锁
4..7 → 13              # 防刷依赖登录/额度/支付
M1..M2 → 14 → 15..18
```

可并行的 Step 组：
- `{2, 3}`（契约 / 页面树互不依赖）
- `{8}` 与 `{5,6,7}`（推荐流与主链路，仅弱依赖 Step 4）
- `{10, 11}` 与 `{12, 13}`
- `{15}`, `{16}`, `{17}` 三条 P1 线可完全并行

---

## M0 — 契约与地基

### Step 1 · Monorepo 脚手架
**Context brief**：全新空目录，仅有 PRD 文件。需在 `apps/miniapp`（uni-app Vue3+Vite+TS）、`apps/server`（NestJS 10 + Prisma + MySQL + Redis）、`apps/admin`（Vite+Vue3+Element Plus，审核/运营后台）、`packages/shared`（共享 TS 类型与枚举）四包建立 pnpm workspace。无 git → 同时 `git init` 并建 `.gitignore`（node_modules、.env、dist、unpackage）。
**Tasks**：
1. pnpm workspace + 四包初始化，ESLint + Prettier + tsconfig strict 统一
2. server：NestJS 骨架、全局 ValidationPipe、异常过滤器、日志(pino)、配置模块（env 校验）
3. server：MySQL/Redis/OSS/微信支付/腾讯云IM/OCR 的 client module（先 mock 实现 + interface，正式实现在对应 Step 接入）
4. miniapp：TabBar 5 项骨架（PRD §5.1）、中老年主题（字号 ≥16pt 基准、高对比 design token）
5. shared：`relation`、`quota_source`、`unlock_status` 等枚举常量
**Verify**：`pnpm -r build` 全绿；`pnpm dev:server` 起服务返回 /health 200；小程序 H5 端可预览 TabBar。
**Exit**：四包可独立开发互不阻塞；所有外部依赖有 interface+mock。
**Model tier**：default。

### Step 2 · OpenAPI 契约 + Prisma DDL
**Context brief**：PRD §7 给出全部表清单；§6 给出关键机制。先契后码是 PRD §12 规定的交付顺序第①②步。
**Tasks**：
1. `docs/openapi.yaml`：按模块（auth/profile/cert/quota/unlock/feed/im/order/coupon/invite/admin）定义全部接口、DTO、错误码
2. `server/prisma/schema.prisma`：§7 全部表 → Prisma model；关键字段索引（unlock_record 唯一键 (initiator_user_id,target_profile_id,status)、member_quota 的 (user_id,status,expire_at)、profile.match_no 唯一）
3. 迁移脚本 baseline + seed（reward_config 默认值全集，见 PRD §11）
4. 生成 server 端 DTO 与 miniapp/admin 端 API client（openapi-typescript-codegen 或手工对齐）
**Verify**：`npx @redocly/cli lint docs/openapi.yaml` 无 error；`prisma migrate dev` 成功；seed 后 reward_config 覆盖 §11 全部 14 项。
**Exit**：前后端可凭契约并行开发；表结构与 PRD §7 逐表对照无遗漏。
**Model tier**：**strongest**（契约错误会放大到全部下游 Step）。

### Step 3 · 页面树与组件清单
**Context brief**：输入 PRD §5 与 §8 中老年适配要求；输出 `docs/PAGES.md` + miniapp 路由表 + 桩页面。
**Tasks**：
1. 页面清单：TabBar 5 + 建档流程（关系选择/资料表单/承诺书/实名/子女授权）+ 详情页 + 聊天室 + 解锁付费页 + 会员购买页 + 我的子页（档案/会员卡/记录×3/设置/邀请/管家留资/反馈）
2. 公共组件：ProfileCard（打码/清晰两态）、Badge（会员/婚姻绿灰标）、QuotaBar、CountdownBar、PayWall 弹窗、二次确认弹窗（口语化文案）
3. 写入 `pages.json` 全部路由 + 空壳页面
**Verify**：路由数与清单一致；桩页面可编译。
**Exit**：每个后续前端任务能直接映射到"某页面的某个状态"。
**Model tier**：default。

---

## M1 — P0 核心链路

### Step 4 · 登录注册与新手礼
**Depends**：2, 3。
**Tasks**：微信 code2session + unionid、手机号绑定；注册即写 user 并发 7 天体验会员+10 额度（status=frozen，source=newbie，D9）；`is_newbie_reward_claimed` 与设备指纹采集。
**Verify**：新用户 DB 中出现 frozen 额度；用例 15（同身份证二次注册无福利）的身份证部分留 Step 6 补全。
**Exit**：openid→user→frozen quota 链路自动化测试通过。

### Step 5 · 建档与多档案管理（D1）
**Tasks**：关系选择（父/母/本人）；子女档案全字段表单（§5.2）+ 相亲编号生成（防枚举：随机+序号，不可猜）；单身承诺书强制勾选留痕（时间+IP+版本，**服务端校验不可绕过**）；婚姻证明可选上传 OSS → 后台选审；一账号 N 档案、单一 is_active、切换接口；编辑后重审（audit_status 重置）；档案预览与转发卡片。
**Verify**：用例 5（未签承诺书→接口拒绝发布）；切换生效档案后 `GET /profiles/active` 变化。
**Exit**：P0 建档全流程（除实名/授权）可走通。

### Step 6 · 实名认证 + 子女授权 + 额度解冻
**Tasks**：身份证 OCR + 人脸核身（第三方 provider interface，先 mock）；certification 落库；关系≠本人 → 子女手机短信验证码 + consent_record 留痕；全部通过 → frozen→active 解冻 + 档案可进推荐池；未实名前端表现：解锁按钮置灰文案"完成实名激活 10 次免费解锁"（用例 11）。
**Verify**：用例 11、12 前半段（被邀请人未实名不发奖——发奖逻辑在 Step 15，此处校验触发点埋点正确）。
**Exit**：主链路 §3.1 的 B→H 全部节点通过。

### Step 7 · 会员与额度账本（D2/D11/D12）
**Tasks**：member_quota 账本服务：`deductOne(userId)` 用 PRD §6.1 原样的 FEFO SQL —— `SELECT ... FOR UPDATE` 行锁 + 事务扣减 + 写流水；定时任务将到期额度置 expired；会员时长叠加规则（有效顺延/过期重激活，D10 复用）；`GET /quota/balance` 返回 X/30 或 X/10。
**Verify**：用例 9（FEFO 先扣体验额度）、用例 10（并发 10 请求仅扣 1 次——用 100 并发压测脚本验证无负数、无超扣）。
**Exit**：**本 Step 是全项目资金安全核心，测试覆盖率 100% 的单元+集成测试**；行锁实现在单测中用真实 MySQL 事务验证。
**Model tier**：**strongest**。

### Step 8 · 解锁状态机与支付（D3，核心）
**Tasks**：解锁接口严格按 §6.1 三步校验顺序（已有 active 复用→FEFO 扣→单次付费 ¥19.9 走 reward_config）；unlock_record 双向生效 30 天，被动方不扣额度；微信支付 module + 回调幂等；coupon 抵扣接口预留（P1 接入券模板）；未核验档案解锁 → 需带 `riskConfirmed=true` 才执行（§6.3）；T+30 定时任务批量置 expired；Refunded 分支：返额度 remaining+1 或原路退款（§6.1）。
**Verify**：用例 1、2、3、6、13；重新解锁重走扣费。
**Exit**：状态机四态迁移全部有集成测试；解锁接口 P99 <200ms（本地基准）。
**Model tier**：**strongest**。

### Step 9 · 推荐流与轮换（D4，§6.2）
**Tasks**：硬过滤（性别相反/已发布/年龄窗 ±10 可配/拉黑互斥）；规则分 50% + 随机 50% 坑位；权重分全部读 reward_config（同城+30…婚姻核验+30/未核验−20）；每日 30% 卡片标"仅今日"次日移出 feed（轮换表 + 定时任务）；"明天起无法查看"话术仅对轮换卡（后台可配）；历史推荐接口（被轮换档案可找回并可解锁）；Redis 缓存分页，首屏 <500ms。
**Verify**：用例 8；分页 P95 <500ms 本地压测。
**Exit**：feed 与 §5.3 卡片字段完全一致（含绿/灰婚姻标、会员徽章、打码头像）。

### Step 10 · IM 集成与聊天室（§5.6）
**Tasks**：腾讯云IM 账号同步（user→IM id）、解锁成功自动建会话并双向开放发消息权限（Default 状态 TIER 控制）、过期/未解锁禁发（服务端 callback 鉴权，非仅前端隐藏）；会话头信息；接触升级三动作（交换微信/拨打电话/发送照片）→ message type=contact_card + 行为留痕表（退款判定依据）；内容风控：msgAudit 回调接鉴黄/敏感词，**解锁前服务端拦截明文微信号/手机号**（正则+OCR 图片兜底策略记录）。
**Verify**：未解锁账号调 IM 发送被 callback 拒绝；用例 2 延伸——解锁双方可互发消息。
**Exit**：离线送达走微信订阅消息的通道配置完成（模板 ID 进 reward_config）。

---

## M2 — P0 配套

### Step 11 · 档案详情页与信任分级（§5.4/§6.3）
**Tasks**：详情页（代理人卡/资料网格/照片两态/警示置顶/上下滑切换）；打招呼免费破冰入口（P0 仅发系统卡片占位，收件箱 P1）；收藏接口；转发微信卡片+海报。
**Verify**：未解锁照片模糊且原图 URL 不外泄（网络层校验）。
**Model tier**：default。

### Step 12 · 消息中心 + 我的（P0 子集）
**Tasks**：会话列表（编号+子女摘要+最后消息+角标）、系统消息（审核/到期/奖励到账模板）、反馈/投诉入口 + ticket 表 + 防诈指南 Banner；我的页：生效档案卡、会员卡（等级/有效期/剩余解锁/特权页）、通知状态开关。
**Verify**：TabBar 角标 = 未读会话数；工单提交落库。

### Step 13 · 管理后台（P0）+ 防刷风控（§5.13/§6.6）
**Tasks**：admin 端登录（独立账号体系）；审核工作台（档案审核、婚姻证明选审、实名复核）；用户/会员管理；额度账本查询（只读）；订单列表 + 退款工单（SLA 48h 首响倒计时）；配置中心 CRUD（reward_config/ops_slot，覆盖 §11 全部项，**禁止硬编码检查**：grep 代码中无 19.9/30/7天 等裸数值）；举报投诉工单 + IM 风控台（消息抽检）；数据看板基础版（注册/实名/解锁/付费漏斗）。防刷：微信/设备指纹/身份证三唯一（唯一索引 + 发奖前校验）、解锁接口限频（Redis 令牌桶）、编号防枚举、支付对账日切任务。
**Verify**：§11 的 14 项参数全部可在后台改并实时生效；用例 15 完整通过（同身份证二次注册无新手福利）。
**Model tier**：strongest（配置中心是唯一真源，做错会返工所有业务代码）。

---

## M3 — P0 验收

### Step 14 · §10 十五条用例自测 + 测试报告
**Tasks**：将 PRD §10 逐条转为集成测试（Jest + supertest，真实 MySQL/Redis，**不 mock 数据库**）；输出 `docs/TEST-REPORT-P0.md`：用例号 → 通过状态 → 关键日志。回归全部前序 Step 测试。
**Exit**：15/15 通过；覆盖率报告（目标：quota/unlock/order 三个资金模块行覆盖 ≥90%，全局 ≥80%）。
**Model tier**：strongest。

---

## M4 — P1 增值（三条线可并行）

### Step 15 · 邀请裂变 + 优惠券 + 续费提醒（D10，§5.10/§5.11）
**Tasks**：邀请码/带参海报；被邀请人**实名通过**事件触发发奖（+7 天+10 额度，有效会员顺延/过期重激活）+ 系统消息；三唯一防刷在发奖处二次校验；券模板/发券/用券（接入 Step 8 预留的 coupon 抵扣）；倒计时条、到期前 2 天（体验）/7 天（付费）提醒节点（定时任务 + 订阅消息）；升级 upsell 立减券。
**Verify**：用例 12、14。

### Step 16 · 三大墙 + 三记录 + 打招呼 + 精准搜索 + 设置（§5.7/§5.8）
**Tasks**：看过我的/收藏我的/解锁我的（列表模糊、会员可见）；解锁/收藏/浏览记录页；打招呼收件箱；搜索（城市/年龄/身高/学历/收入）；设置全集：换绑手机、实名信息、子女授权管理、仅同城可见开关、**注销账号与个人信息删除（PIPL，物理删除或匿名化 + 留痕）**、清缓存、子女协助管理开关（开启后 ≥¥500 支付通知子女）。

### Step 17 · 加速脱单管家 + 退款工单流（D6/D7）
**Tasks**：服务说明页 + 留资表单（manager_lead）→ 后台派单 → 管家复用 IM 发 1v1 会话；退款公式三边界实现（§6.5：0 消耗全退 / 已消耗折抵 / 末 30 天拒退，赠送权益不退；单次解锁 24h 违规全退+返额度、已交换微信或已拨电话不退、过期不退）；退款走微信原路退回 API + 工单状态机。
**Verify**：用例 7。

---

## M5 — P2 占位

### Step 18 · 占位不开发（D8）
**Tasks**：直播浮窗、本地群入口仅做"敬请期待"静态占位 + 接口 stub；不建表不开发。

---

## 全局不变量（每个 Step 完成后复查）

| # | 不变量 | 验证方式 |
|---|---|---|
| I1 | 金额/时长/额度/权重/话术无硬编码 | grep 裸数值 + code review |
| I2 | 扣额度必须行锁事务 | Step 7 压测 + 代码审查 |
| I3 | 解锁前服务端（非前端）拦截明文联系方式 | Step 10 越权测试 |
| I4 | 承诺书校验在服务端且不可绕过 | Step 5 接口直调测试 |
| I5 | 敏感信息（身份证/人脸/婚姻证明）单独同意留痕 | Step 6 数据审查 |
| I6 | 字号 ≥16pt、层级 ≤3、关键操作口语化二次确认 | 每前端 Step UI 走查 |
| I7 | 外部服务（支付/IM/OCR/短信）全部 interface+mock，可脱离第三方联调 | CI 无外网可跑测试 |

## 执行说明

- 每个 Step = 一次可独立验收的提交（direct 模式下即一组聚焦 commit）。
- Step 失败即停：修复通过 Verify 后才进入下一 Step，禁止跳过验证继续堆功能。
- 强模型 Step（2、7、8、13、14）执行时禁止并行开其他写任务；default Step 可在依赖满足时并行。
- 计划变更协议：拆分/插入/跳过/重排 Step 时，更新本文件依赖图并在 Step 标题下追加 `> Amended YYYY-MM-DD: 原因`。
