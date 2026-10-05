<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 我的（PRD §5.8）：账号概览 + 会员/额度卡 + 各功能入口
interface Me {
  id: string;
  nickname: string | null;
  phoneMasked: string | null;
  relation: string | null;
  memberLevel: string;
  memberExpireAt: string | null;
  realnamePassed: boolean;
  inviteCode: string | null;
  quotaBalance: { totalRemaining: number };
}
interface MemberMe {
  level: string;
  expireAt: string | null;
  quota: { totalRemaining: number; limitLabel: string };
}

const me = ref<Me | null>(null);
const member = ref<MemberMe | null>(null);

const relationText: Record<string, string> = { FATHER: '父亲', MOTHER: '母亲', SELF: '本人' };

onShow(async () => {
  me.value = await http.get<Me>('/auth/me', { toast: false }).catch(() => null);
  member.value = await http.get<MemberMe>('/member/me', { toast: false }).catch(() => null);
});

function go(url: string, tab = false) {
  if (tab) uni.switchTab({ url });
  else uni.navigateTo({ url });
}

function logout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    success: (r) => {
      if (!r.confirm) return;
      uni.removeStorageSync('qj_token');
      uni.reLaunch({ url: '/pages/auth/login/index' });
    },
  });
}
</script>

<template>
  <view class="page">
    <view v-if="me" class="head">
      <view class="avatar"><text>亲家</text></view>
      <view class="who">
        <text class="nick">{{ me.nickname || '未设置昵称' }}</text>
        <text class="meta">{{ me.phoneMasked }} · {{ relationText[me.relation || ''] || '' }}</text>
        <text class="meta">{{ me.realnamePassed ? '已实名' : '未实名' }} · 解锁次数剩 {{ me.quotaBalance.totalRemaining }}</text>
      </view>
    </view>
    <view v-else class="head">
      <text class="login-tip" @click="go('/pages/auth/login/index')">未登录，点击登录</text>
    </view>

    <view class="member-card" :class="{ paid: (member?.level || me?.memberLevel) === 'PAID' }" @click="go('/pages/member/purchase/index')">
      <view class="mc-row">
        <text class="mc-title">{{ (member?.level || me?.memberLevel) === 'PAID' ? '会员' : '普通用户' }}</text>
        <text class="mc-btn">{{ (member?.level || me?.memberLevel) === 'PAID' ? '查看特权' : '开通会员' }}</text>
      </view>
      <text v-if="member?.expireAt" class="mc-sub">有效期至 {{ member.expireAt.slice(0, 10) }}</text>
      <text v-if="member" class="mc-sub">解锁次数剩 {{ member.quota.totalRemaining }}（{{ member.quota.limitLabel }}）</text>
    </view>

    <view class="group">
      <text class="g-title">我的资料</text>
      <view class="item" @click="go('/pages/profile/list/index')"><text>我的档案</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/records/index/index')"><text>解锁记录</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/feed/history/index')"><text>历史推荐</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/message/wall/index')"><text>谁对我有意向</text><text class="arrow">›</text></view>
    </view>

    <view class="group">
      <text class="g-title">优惠与推广</text>
      <view class="item" @click="go('/pages/mine/coupons/index')"><text>我的优惠券</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/mine/invite/index')"><text>邀请好友得奖励</text><text class="arrow">›</text></view>
    </view>

    <view class="group">
      <text class="g-title">安全与设置</text>
      <view class="item" @click="go('/pages/mine/anti-fraud/index')"><text>防诈骗指南</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/settings/notify/index')"><text>通知设置</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/mine/settings/index')"><text>设置</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/mine/feedback/index')"><text>意见反馈</text><text class="arrow">›</text></view>
    </view>

    <text v-if="me" class="logout" @click="logout">退出登录</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.head { display: flex; align-items: center; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.avatar { width: 120rpx; height: 120rpx; border-radius: 50%; background: #ffe0df; display: flex; align-items: center; justify-content: center; }
.avatar text { font-size: 32rpx; color: #e64340; }
.who { flex: 1; margin-left: 24rpx; }
.nick { display: block; font-size: 40rpx; font-weight: bold; color: #222; }
.meta { display: block; margin-top: 8rpx; font-size: 28rpx; color: #666; }
.login-tip { font-size: 36rpx; color: #e64340; }
.member-card { margin-top: 24rpx; padding: 28rpx; background: linear-gradient(135deg, #fff3e0, #ffe0b2); border-radius: 20rpx; }
.member-card.paid { background: linear-gradient(135deg, #3e2723, #6d4c41); }
.member-card.paid .mc-title, .member-card.paid .mc-sub { color: #fff; }
.member-card.paid .mc-btn { color: #3e2723; background: #ffd54f; }
.mc-row { display: flex; justify-content: space-between; align-items: center; }
.mc-title { font-size: 38rpx; font-weight: bold; color: #4e342e; }
.mc-btn { font-size: 30rpx; color: #fff; background: #e64340; border-radius: 12rpx; padding: 10rpx 28rpx; }
.mc-sub { display: block; margin-top: 10rpx; font-size: 28rpx; color: #7a5c3e; }
.group { margin-top: 28rpx; background: #fff; border-radius: 20rpx; overflow: hidden; }
.g-title { display: block; padding: 24rpx 28rpx 8rpx; font-size: 30rpx; color: #999; }
.item { display: flex; justify-content: space-between; align-items: center; padding: 28rpx; border-bottom: 2rpx solid #f5f5f5; font-size: 34rpx; color: #222; }
.item:last-child { border-bottom: none; }
.arrow { color: #ccc; font-size: 36rpx; }
.logout { display: block; margin-top: 40rpx; text-align: center; font-size: 32rpx; color: #e64340; }
</style>
