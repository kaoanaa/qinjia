# 完美亲家 · 页面树与组件清单（Step 3）

> 中老年适配总则（PRD §8 / 红线 I6）：字号 ≥16pt（$font-base=32rpx）、高对比（#222 on #FFF）、
> 层级 ≤3、主操作按钮 ≥96rpx 高、关键动作口语化二次确认。所有文案数值来自配置接口，禁止前端硬编码。

## 1. 页面树（36 路由，与 pages.json 一一对应）

### TabBar（5）
| 路由 | 页面 | 实现 Step | 关键状态 |
|---|---|---|---|
| pages/today/index | 今日推荐 feed | 9 | 加载中骨架 / 空态（未建档引导建档）/ 卡片流（含"仅今日"角标+话术条）/ 下拉分页 <500ms |
| pages/speedup/index | 加速脱单说明 | 17 | 服务介绍 → 留资入口 CTA |
| pages/activity/index | 运营活动位 | 13 | ops_slot 驱动，可配置隐藏 |
| pages/message/index | 消息中心 | 10,12 | 会话列表（编号+子女摘要+最后消息+角标）/ 系统消息入口 / 三大墙入口 / 打招呼收件箱 / 防诈 Banner |
| pages/mine/index | 我的 | 12 | 生效档案卡 / 会员卡（剩余解锁 X/30 或 X/10）/ 记录入口 / 优惠券 / 邀请 / 设置 / 管家会话入口 |

### 注册建档流（8）
| 路由 | 页面 | Step | 备注 |
|---|---|---|---|
| pages/auth/login | 微信授权+手机号绑定 | 4 | 登录即 frozen 发奖提示 |
| pages/profile/relation | 选择关系（父亲/母亲/本人 大卡片三选一） | 5 | 本人→跳过子女授权 |
| pages/profile/form | 子女档案表单（§5.2 全字段，分组分步） | 5 | 编辑模式=重审提示 |
| pages/profile/commitment | 单身承诺书（全文+勾选留痕） | 5 | 未签不可发布（I4） |
| pages/cert/realname | 实名：OCR 拍照+人脸核身跳转 | 6 | |
| pages/cert/child-consent | 子女短信授权（验证码+声明勾选） | 6 | consent 留痕 |
| pages/profile/list | 我的档案列表（新建/编辑/切换生效/删除） | 5 | 切换确认话术（D1） |
| pages/profile/preview | 档案预览（对方视角所见即所得） | 5,11 | 复用详情页组件 |

### 浏览-解锁-接触（5）
| 路由 | 页面 | Step | 关键状态 |
|---|---|---|---|
| pages/feed/detail | 对方详情（§5.4） | 11 | 未解锁照片模糊 / 绿灰婚姻标 / 未核验置顶警示 / 打招呼·收藏·去打电话·转发·上下滑 |
| pages/feed/history | 历史推荐 | 9 | 被轮换卡找回，可解锁（用例 8） |
| pages/unlock/paywall | 解锁确认页 | 8 | 三态：额度可用（FEFO 余额）/ 需付费（价格下发）/ 未实名置灰引导；未核验→二次风险确认弹窗 |
| pages/member/purchase | 会员购买 | 8 | 套餐卡（配置下发）/ 券抵扣 / ≥阈值支付确认提示 |
| pages/chat/room | 聊天室（IM） | 10 | 会话头 / 禁发态（未解锁·过期提示重新解锁）/ 接触升级三按钮 |

### 消息与记录（4）
| 路由 | 页面 | Step |
|---|---|---|
| pages/message/system | 系统消息（审核/到期/奖励到账） | 12 |
| pages/message/wall | 三大墙（query: viewed/favorited/unlocked，非会员模糊） | 16 |
| pages/message/greeting | 打招呼收件箱 | 16 |
| pages/records/index | 解锁/收藏/浏览记录（query: type） | 16 |

### 我的扩展（6）
| 路由 | 页面 | Step |
|---|---|---|
| pages/member/privileges | 会员特权页（权益项配置下发） | 12 |
| pages/mine/coupons | 优惠券（面额+过期倒计时） | 15 |
| pages/mine/invite | 邀请好友（海报+奖励规则+记录） | 15 |
| pages/mine/anti-fraud | 防骗指南（必备） | 12 |
| pages/mine/settings | 设置首页 | 16 |
| pages/mine/feedback | 反馈/投诉（工单+进度） | 12 |

### 设置子页（7）
| 路由 | 页面 | Step | 合规 |
|---|---|---|---|
| pages/settings/phone-rebind | 换绑手机 | 16 | |
| pages/settings/realname-info | 实名信息（脱敏展示） | 16 | I5 |
| pages/settings/consents | 子女授权管理（查看/撤销） | 16 | PIPL |
| pages/settings/privacy | 仅同城可见 / 子女协助管理 | 16 | |
| pages/settings/close-account | 注销账号（二次确认+冷静期） | 16 | PIPL 删除权 |
| pages/settings/notify | 通知开关+订阅消息一键授权 | 12 | |
| pages/speedup/lead | 管家留资表单（城市/期望/预算） | 17 | |

### 搜索（1）
| 路由 | 页面 | Step |
|---|---|---|
| pages/search/index | 精准搜索（城市/年龄/身高/学历/收入） | 16 |

## 2. 公共组件清单（easycom `qj-*`，随首个使用 Step 落地）

| 组件 | 职责 | 首用 Step | 状态 |
|---|---|---|---|
| qj-profile-card | 推荐卡：打码/清晰两态头像、徽章、"仅今日"角标 | 9 | 待建 |
| qj-badge | 会员徽章 / 婚姻绿灰标 / 实名印章（文案下发） | 9 | 待建 |
| qj-photo-grid | 照片网格：未解锁全部模糊（服务端下发模糊 URL） | 11 | 待建 |
| qj-quota-bar | 额度展示 "剩余解锁 X/Y"（FEFO 汇总） | 8 | 待建 |
| qj-paywall-sheet | 付费墙半屏：额度/单次价/券抵扣/开会员，价格全下发 | 8 | 待建 |
| qj-confirm-dialog | 口语化二次确认（风险确认/切换档案/注销） | 5 | 待建 |
| qj-countdown-bar | 券/到期倒计时条（营销位） | 15 | 待建 |
| qj-big-button | 主操作大按钮（≥96rpx，电话/微信最大化） | 4 | 待建 |
| qj-agent-header | 代理人卡：昵称+关系+徽章+编号+子女摘要 | 10,11 | 待建 |
| qj-empty-state | 空态插画+引导 | 9 | 待建 |
| qj-form-*（field/picker/region） | 档案表单控件集（大字号选择器） | 5 | 待建 |

## 3. 全局导航规则

- 层级 ≤3：Tab → 一级子页 → 弹层/半屏（付费墙、确认、筛选均用 sheet 不新增路由）。
- 未建档/未实名用户进入 today/mine 强制引导流：relation → form → commitment → cert。
- 解锁过期会话进入后顶部横幅"联系已过期，重新解锁可继续聊天"（D3，跳 paywall）。
- 转发（微信卡片/海报）落地：未登录走 login → 带参进对方详情页。
