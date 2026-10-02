<script setup lang="ts">
import { ConfigKeys } from '@qinjia/shared';
</script>

<template>
  <el-container>
    <el-header><h2>完美亲家 · 管理后台</h2></el-header>
    <el-main>
      <el-alert
        title="脚手架已就绪：审核工作台/账本/订单/配置中心在 Step 13 实现"
        type="info"
        :closable="false"
      />
      <p>配置项 key 清单（禁止硬编码，均走 reward_config）：{{ Object.values(ConfigKeys).join(', ') }}</p>
    </el-main>
  </el-container>
</template>
