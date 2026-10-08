<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, auth } from '../api';

const router = useRouter();
const form = reactive({ username: '', password: '' });
const busy = ref(false);

async function submit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  busy.value = true;
  try {
    // 密码走 bcrypt 校验（服务端），前端不落盘；token 独立受众 admin-console
    const res = await api.post<{ token: string; role: string }>('/auth/login', form);
    auth.save(res.token, res.role, form.username);
    void router.replace('/');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="wrap">
    <el-card class="card">
      <div class="title">完美亲家 · 管理后台</div>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="账号">
          <el-input v-model="form.username" placeholder="管理员账号" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="密码" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" class="btn" :loading="busy" @click="submit">登 录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.wrap { height: 100%; display: flex; align-items: center; justify-content: center; background: #1f2d3d; }
.card { width: 360px; padding: 8px 12px 16px; }
.title { font-size: 20px; font-weight: bold; text-align: center; margin: 8px 0 20px; color: #1f2d3d; }
.btn { width: 100%; }
</style>
