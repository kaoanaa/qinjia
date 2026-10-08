/** 管理端 API 封装：/admin/v1 直连（服务端 CORS 已开），独立受众 JWT（红线：与用户 token 分离） */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000/admin/v1';

const TOKEN_KEY = 'qj_admin_token';
const ROLE_KEY = 'qj_admin_role';
const NAME_KEY = 'qj_admin_name';

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  },
  get role() {
    return localStorage.getItem(ROLE_KEY) ?? '';
  },
  get username() {
    return localStorage.getItem(NAME_KEY) ?? '';
  },
  save(token: string, role: string, username: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(NAME_KEY, username);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(NAME_KEY);
  },
  /** 角色门控（与 admin.controller @Roles 对齐） */
  can(...roles: string[]) {
    return roles.includes(this.role);
  },
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly errorCode?: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    auth.clear();
    location.hash = '#/login';
    throw new ApiError(401, '登录已过期，请重新登录');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? `请求失败（${res.status}）`, data?.errorCode);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
};

/** 金额分 → 元（全站金额以分存储，禁止浮点运算，展示层除 100） */
export const yuan = (cent: number | null | undefined) => (cent == null ? '-' : `¥${(cent / 100).toFixed(2)}`);

export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-');

export const fmtMsLeft = (ms: number) => {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  return `${neg ? '已超时 ' : '剩余 '}${h}小时${m}分`;
};
