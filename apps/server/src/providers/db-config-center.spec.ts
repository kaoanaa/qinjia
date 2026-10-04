import { DbConfigCenter } from './db-config-center';
import { PrismaService } from '../prisma/prisma.service';

/** 配置中心真实实现单测（§3.5 / 红线 I1）：缓存命中、后台保存失效实时生效、缺失 key 抛错 */
describe('DbConfigCenter', () => {
  function makePrisma(value: unknown) {
    const findUnique = jest.fn().mockResolvedValue({ value });
    return { prisma: { rewardConfig: { findUnique } } as unknown as PrismaService, findUnique };
  }

  it('首次读落缓存：DB 变更后仍返回旧值（缓存期内）', async () => {
    const { prisma, findUnique } = makePrisma({ amountCent: 1990 });
    const c = new DbConfigCenter(prisma);
    expect(await c.get('unlock_once_price')).toEqual({ amountCent: 1990 });
    findUnique.mockResolvedValue({ value: { amountCent: 999 } }); // 后台改了 DB
    expect(await c.get('unlock_once_price')).toEqual({ amountCent: 1990 }); // 仍读缓存
    expect(findUnique).toHaveBeenCalledTimes(1); // 第二次未再查库
  });

  it('invalidate(key) 后实时生效：重新读库拿到新值（后台保存即失效链路）', async () => {
    const { prisma, findUnique } = makePrisma({ firstResponseHours: 48 });
    const c = new DbConfigCenter(prisma);
    expect(await c.get('ticket_sla')).toEqual({ firstResponseHours: 48 });
    findUnique.mockResolvedValue({ value: { firstResponseHours: 24 } });
    c.invalidate('ticket_sla');
    expect(await c.get('ticket_sla')).toEqual({ firstResponseHours: 24 });
  });

  it('缺失配置项直接抛错，禁止业务默认值兜底（I1）', async () => {
    const findUnique = jest.fn().mockResolvedValue(null); // 无此配置行
    const c = new DbConfigCenter({ rewardConfig: { findUnique } } as unknown as PrismaService);
    await expect(c.get('rate_limit')).rejects.toThrow(/缺失配置项/);
  });
});
