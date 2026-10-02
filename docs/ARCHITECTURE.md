# 完美亲家 · 系统架构

> 需求唯一来源：根目录 PRD。本文只描述"怎么实现"，不复述"实现什么"。

## 1. 总览

```
┌─────────────────────────────┐   ┌──────────────┐
│ uni-app 小程序 (Vue3+TS)     │   │ Admin 后台    │
│ apps/miniapp                │   │ apps/admin   │
└──────────┬──────────────────┘   └──────┬───────┘
           │ HTTPS (openapi.yaml 契约)    │
┌──────────▼──────────────────────────────▼───────┐
│ NestJS 单体（模块化，apps/server）                │
│ auth│profile│cert│quota│unlock│feed│im-gateway   │
│ order│coupon│invite│notify│ticket│admin│config   │
├─────────────────────────────────────────────────┤
│ 横切：Validation│Guard(限频/实名态)│Pino日志│全局异常│
│ 定时任务：@nestjs/schedule（额度/解锁过期、轮换、提醒、对账）│
│ 事件：@nestjs/event-emitter（实名通过→解冻/发奖等）      │
└───┬─────────┬────────┬────────┬────────┬─────────┘
    │         │        │        │        │
  MySQL 8   Redis    OSS   腾讯云IM   微信开放能力
  (Prisma)  (缓存/   (照片/ (账号/会话/  (登录/支付/
            限频/    证明)  消息回调)     订阅消息/短信)
            feed)
    + 第三方：身份证OCR + 人脸核身（provider interface 可替换）
```

**单体 + 强模块化**：MVP 阶段流量可预估，不引入微服务；模块间仅通过 service 接口调用，禁止跨模块直接查表（保持未来可拆分性）。

## 2. 目录结构

```
QinJia/
├── apps/
│   ├── miniapp/       # uni-app：pages/ components/ api/(生成) stores/ theme/
│   ├── server/        # NestJS：src/modules/<domain>/ {controller,service,dto,*.spec.ts}
│   │   └── prisma/    # schema.prisma + migrations + seed.ts
│   └── admin/         # Vite + Element Plus，审核/运营
├── packages/shared/   # 枚举、常量、API 类型（三端共用）
├── docs/              # PLAN.md / ARCHITECTURE.md / openapi.yaml / PAGES.md / 测试报告
└── CLAUDE.md
```

## 3. 关键机制实现方案

### 3.1 FEFO 额度扣减（资金安全核心）
- 实现：`QuotaLedgerService.deductOne(userId, tx)`，Prisma `$transaction` 内
  `$queryRaw` 执行 PRD §6.1 的 `SELECT ... FOR UPDATE`，再 UPDATE remaining、写 unlock_record、写流水。
- 禁止：任何"先查后扣"的非事务写法；单元测试必须跑真实 MySQL（不用 mock DB 测扣减）。
- 幂等：解锁接口以 (initiator, target, 请求幂等键 Redis SETNX) 防重复提交。

### 3.2 解锁状态机
- 单一事实源：`unlock_record.status`；Active→Expired 由每小时定时任务 + **读时兜底**（查询时若 now>expire_at 视为 expired 并触发修正）双保险，避免定时任务延迟导致越权可见。
- 联系方式可见性、IM 发消息权限、照片清晰度三处均只依赖服务端 `getUnlockStatus()`，前端仅做展示。

### 3.3 推荐流
- 硬过滤 + 规则分在 MySQL 查询层完成（档案量 <10 万假设）；随机坑位应用层混排；结果按 (activeProfileId, date) 缓存 Redis，TTL 5min。
- 轮换：`feed_rotation` 表记录每日 30% 选中集，次日 feed 查询 `NOT IN` 昨日轮换集；历史推荐 = 查 feed_rotation 关联。

### 3.4 IM（腾讯云IM）
- useruser 全同步；解锁成功 → 服务端导入双方好友关系（SS 模式）并开权限。
- 发消息权限：REST API 回调校验 unlock_record（active 且未过期），未解锁一律 reject；云端回调内做敏感联系方式拦截 + 鉴黄。
- 离线：微信订阅消息补达（notify_pref 控制）。

### 3.5 配置中心（禁止硬编码的落地）
- `reward_config`（key-value JSON）+ `ops_slot`；server 端 `ConfigService.getTyped(key)` 带 Redis 缓存 + 后台保存时主动失效。
- seed.ts 灌入 PRD §11 全部 14 项默认值；CI 中 grep 检查业务代码不出现裸的价格/时长/权重数值。

### 3.6 支付与对账
- 微信支付 V3 JSAPI；回调幂等（transaction_id 唯一索引）；订单状态机 paid/refunding/refunded。
- 日切对账任务：本地 order vs 微信账单，差异进工单；≥¥500 短信二次确认在 prepay 前拦截（阈值读配置）。

### 3.7 防刷三唯一
- `user` 表对 (openid)、(id_card_no 摘要)、(device_fingerprint) 建唯一/查重索引；新手礼与邀请奖励发放前校验 `is_newbie_reward_claimed` + 身份证终身唯一。
- 解锁/搜索/ feed 接口 Redis 令牌桶限频（Guard 实现）。

### 3.8 定时任务清单
| 任务 | 频率 | 职责 |
|---|---|---|
| quota-expire | 10min | member_quota → expired |
| unlock-expire | 1h | unlock_record → expired + IM 关权限 |
| feed-rotation | 每日 00:05 | 生成当日轮换集、移出昨日卡 |
| renew-remind | 每日 | 到期前 2/7 天提醒 + 发券 |
| pay-reconcile | 每日凌晨 | 支付对账 |

## 4. 环境

| 变量组 | 项 |
|---|---|
| 基础 | DATABASE_URL, REDIS_URL, PORT |
| 微信 | WX_APPID, WX_SECRET, WXPAY_MCHID, WXPAY_KEY, WX_MSG_CALLBACK_TOKEN |
| 腾讯云IM | IM_SDKAPPID, IM_SECRETKEY |
| OSS/短信/OCR | 按 provider 接口配置，可随时换厂商 |

开发环境：docker-compose 起 MySQL+Redis；第三方全部走 Step 1 定义的 mock provider。

## 5. 测试策略

- 单元：quota/unlock/refund 公式（含 §10 用例 7 三边界）。
- 集成：Jest + supertest + 真实 MySQL/Redis（testcontainers 或本地 compose），IM/支付/OCR 用 mock provider。
- 并发：额度扣减 100 并发压测断言"仅扣 1 次、无负数"（用例 10）。
- 前端：uni-app H5 端冒烟（TabBar 渲染、建档流程走通）。
- 验收：§10 十五条逐条映射集成测试，输出 TEST-REPORT-P0.md。
