/**
 * uni.request 封装：BASE_URL、token 注入、统一错误 toast、401 跳登录。
 * 后端契约见 docs/openapi.yaml；错误响应 {code,message,errorCode?}。
 */
const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE || 'http://localhost:3000/api/v1';

const TOKEN_KEY = 'qj_token';

export function getToken(): string {
  return uni.getStorageSync(TOKEN_KEY) || '';
}
export function setToken(token: string) {
  uni.setStorageSync(TOKEN_KEY, token);
}
export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY);
}

export interface ApiError {
  code: number;
  message: string;
  errorCode?: string;
}

interface RequestOptions {
  /** 传 false 时不弹 toast，由页面自行处理（如付费墙 202、风险确认） */
  toast?: boolean;
  headers?: Record<string, string>;
}

function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown, opts: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + path,
      method,
      data: data as Record<string, unknown> | undefined,
      header: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...opts.headers,
      },
      success: (res) => {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          resolve(res.data as T);
          return;
        }
        const body = (res.data ?? {}) as ApiError;
        const message = body.message || '网络开小差了，请稍后再试';
        if (status === 401) {
          clearToken();
          uni.navigateTo({ url: '/pages/auth/login/index' });
        }
        if (opts.toast !== false) {
          uni.showToast({ title: message, icon: 'none', duration: 2500 });
        }
        reject({ code: status, message, errorCode: body.errorCode } as ApiError);
      },
      fail: () => {
        const message = '网络连接失败，请检查后端服务是否启动';
        if (opts.toast !== false) uni.showToast({ title: message, icon: 'none', duration: 2500 });
        reject({ code: 0, message } as ApiError);
      },
    });
  });
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, data?: unknown, opts?: RequestOptions) => request<T>('POST', path, data, opts),
  put: <T>(path: string, data?: unknown, opts?: RequestOptions) => request<T>('PUT', path, data, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

/** 生成本次请求的幂等键（解锁等接口要求 Idempotency-Key 头） */
export function idemKey(prefix = 'ik'): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}
