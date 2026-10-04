# P0 验收测试报告（Step 14 · PRD §10 十五条用例）

- 日期：2026-10-04（Step 15 完成后回归更新）
- 环境：真实 MySQL 8 + Redis（podman 容器 qj-mysql/qj-redis），`MOCK_PROVIDERS=false`（DbConfigCenter + RedisKvCache），**禁 mock 数据库**
- 命令：`pnpm --filter @qinjia/server test`（单测）、`pnpm --filter @qinjia/server test:e2e`（集成）
- 结果总览：**e2e 13 套件 / 80 用例全部通过；单测 7/7；`pnpm -r build` 全绿**

## 一、§10 十五条用例映射

| # | 用例 | 状态 | 覆盖测试（文件 › 用例名） | 关键断言/日志 |
|---|------|------|--------------------------|----------------|
| 1 | 额度=0 → 单次付费；账本无负数 | ✅ | unlock.e2e › 用例 1 | 202 need_payment ¥19.9（读配置）；HTTP 回调履约写解锁；重复回调幂等；quotaTxLog 无负 |
| 2 | A 解锁 B，B 免操作见联系方式；B 额度不变 | ✅ | unlock.e2e › 用例 2；chat.e2e › 解锁后双向互发 | A 余量 -1、拿到手机号；B 批次 remaining 不变；双向 callback OK |
| 3 | T+30 过期清扫；双方发消息拒绝；会话历史可查 | ✅ | unlock.e2e › 用例 3+状态机；chat.e2e › 过期后 callback FAIL | 定时任务置 EXPIRED；FAIL 20002 + 重新解锁话术；重解锁新记录再扣费；conversation 保留 |
| 4 | 双档案切换：feed/对外身份随生效档案；旧解锁会话不受影响 | ✅ | acceptance.e2e › 用例 4 | 切换后 A 的 feed 性别窗整体翻转；他人 feed 只见生效档案（P1 下架/P2 上架）；解锁记录仍 ACTIVE、双向 IM 放行、额度只扣 1 |
| 5 | 婚姻证明未传可发布（灰标+警示）；承诺书未签禁发布 | ✅ | profile.e2e › 未勾选承诺书 403；feed.e2e › 卡片用例 | COMMITMENT_REQUIRED 硬拒；verified=false 灰标 + unverifiedWarnTop 话术（读配置） |
| 6 | 有效期内重复解锁 → 不扣额度不扣费 | ✅ | unlock.e2e › 用例 6 | 复用同一 ACTIVE 记录；Idempotency-Key 缺失 400 / 重放幂等 |
| 7 | 退款公式三边界（0 消耗全退/已消耗折抵/末 30 天拒退） | ⏸ P1 | — 依赖 Step 17（退款工单流）实现后回归 | 机制预留：unlock REFUNDED 返额度链路已由 admin.e2e › 违规下架返额度（quotaTxLog REFUND）验证 |
| 8 | 轮换档案次日不在 feed，历史推荐可找回且可解锁 | ✅ | feed.e2e › 用例 8 | 昨日轮换卡移出当日 feed；`GET /feed/history` 可找回；解锁仍可发起 |
| 9 | FEFO：先扣快到期体验额度 | ✅ | quota-ledger.e2e › 用例 9 | 体验(剩2天)+付费(剩300天) 并存 → 先扣体验，扣完转付费 |
| 10 | 并发 10（实测 100）解锁同一目标仅扣 1 次 | ✅ | quota-ledger.e2e › 用例 10 | remaining=1 并发 100 → 恰 1 成功；行锁（§6.1 FOR UPDATE）；无负数无超扣 |
| 11 | 未实名：额度 frozen、解锁置灰提示话术 | ✅ | cert.e2e › 用例 11；auth.e2e | frozen=10/usable=0；实名通过后解冻 active；unlockBtnRealnameGuide 话术读配置 |
| 12 | 被邀请人实名通过才发奖（+7天+10额度+系统消息）；未实名不发奖 | ✅ | invite.e2e › 用例 12；cert.e2e › 用例 12 | 注册仅挂 Referral PENDING 不发奖；实名通过 → REWARDED、邀请人 +7 天（过期重激活/有效期内顺延）+INVITE 批次 10 额度+quotaTxLog GRANT；系统消息标题读 copywriting 配置（I1）；同设备指纹二次校验 REJECTED 不叠加 |
| 13 | 解锁未核验档案 → 二次风险确认后才扣费 | ✅ | unlock.e2e › 用例 13 | 412 RISK_CONFIRM_REQUIRED 不扣费；确认后 200 且 riskConfirmed 留痕 |
| 14 | 体验到期前 2 天 / 付费到期前 7 天续费提醒+券 | ✅ | invite.e2e › 用例 14 | MemberRemindJob：TRIAL 剩 1 天 → 发「体验到期续费券」（模板名读 coupon_templates 配置）+ activity 系统消息；PAID 剩 5 天 → 提醒；剩 20 天（窗外）→ 0 打扰；RemindLog 唯一锚去重（同周期重跑不重发），续费后新到期日重新锚定可再提醒 |
| 15 | 同身份证第二次注册 → 无新手福利 | ✅ | cert.e2e › 用例 15 | duplicateIdCard=true；第二账号实名通过但新手礼保持 frozen；idCardNoHash 唯一键属首账号 |

**小结**：14/15 通过；仅用例 7（退款公式三边界）依赖 Step 17（退款工单流），实现后回归补齐至 15/15。

## 二、Step 13 Verify（随本报告复核）

- §11 配置项全部可后台改并实时生效：admin.e2e › 配置中心（GET 全集/PUT 单项/未知 key 400/AdminAuditLog 留痕）+ db-config-center.spec（invalidate 后实时重读，缺 key 抛错，红线 I1）
- 裸数值红线扫描：业务代码无 `19.9/30/7天` 等硬编码（仅 seed 与 dev mock 配置源含默认值，属 §11 唯一真源载体）

## 三、覆盖率

| 目标 | 实际（行） | 门槛 |
|---|---|---|
| order | 94.44% | ≥90 ✅ |
| quota | 100% | ≥90 ✅ |
| unlock | 93.90% | ≥90 ✅ |
| 资金三模块合并（test:e2e:money） | 95.18% | ≥90 ✅ |
| 全局 src（e2e，排除 spec/module/dto） | 92.15% | ≥80 ✅ |

## 四、测试资产清单

- e2e（13 套件 / 80 用例）：acceptance、admin、auth、cert、chat、detail、feed、health、invite、misc、profile、quota-ledger、unlock
- 单测（7）：unlock-rate-limit.guard.spec（限频 429/配置驱动/按用户分桶）、db-config-center.spec（缓存/失效/缺 key 抛错）
- 数据隔离：各套件唯一 matchNo/标记前缀（FM/FV/MD/MN/MP/MC/AD/AC/IN）；acceptance 套件 afterAll 停用 AC 候选，防污染 feed 全池 total 断言
