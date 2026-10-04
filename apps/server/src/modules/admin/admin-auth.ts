import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminContext {
  id: bigint;
  username: string;
  role: string;
}

export type AdminRequest = Request & { admin?: AdminContext };

const DEV_ADMIN_SECRET = 'dev_admin_secret_change_me';
export const ADMIN_ROLES_KEY = 'admin_roles';
export const ADMIN_AUD = 'admin-console';

/** 角色白名单（§5.13 独立账号体系）：不标注则任意管理员可用 */
export const Roles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

import { createParamDecorator } from '@nestjs/common';
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): AdminContext => {
  const req = ctx.switchToHttp().getRequest<AdminRequest>();
  if (!req.admin) throw new UnauthorizedException('请先登录后台');
  return req.admin;
});

/**
 * 管理端鉴权：独立 JWT 受众（aud=admin-console，与小程序 token 互不可用，防越权），
 * 叠加角色校验（Roles 元数据）。
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private secret(): string {
    const s = this.config.get<string>('ADMIN_JWT_SECRET') ?? DEV_ADMIN_SECRET;
    if (s === DEV_ADMIN_SECRET && this.config.get('NODE_ENV') === 'production') {
      throw new Error('生产环境必须配置 ADMIN_JWT_SECRET');
    }
    return s;
  }

  sign(admin: { id: bigint; username: string; role: string }): string {
    return this.jwt.sign({ sub: admin.id.toString(), username: admin.username, role: admin.role, aud: ADMIN_AUD }, { secret: this.secret() });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('请先登录后台');
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7), { secret: this.secret(), audience: ADMIN_AUD });
    } catch {
      throw new UnauthorizedException('后台登录已过期，请重新登录');
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { id: BigInt(payload.sub) } });
    if (!admin || !admin.enabled) throw new UnauthorizedException('账号不存在或已停用');
    req.admin = { id: admin.id, username: admin.username, role: admin.role };

    const allowed = this.reflector.getAllAndOverride<string[]>(ADMIN_ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (allowed && !allowed.includes(admin.role)) throw new ForbiddenException('无权限执行该操作');
    return true;
  }
}
