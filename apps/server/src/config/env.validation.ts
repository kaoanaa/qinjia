import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';

export class EnvVars {
  @IsInt() @Min(1) @IsOptional()
  PORT: number = 3000;

  @IsString() @IsOptional()
  NODE_ENV: string = 'development';

  @IsString() @IsOptional()
  LOG_LEVEL: string = 'info';

  // Step 2+ 接入真实实现后必填；Step 1 允许 mock
  @IsString() @IsOptional()
  DATABASE_URL?: string;

  @IsString() @IsOptional()
  REDIS_URL?: string;

  /** 外部服务 mock 开关：development/test 默认 true */
  @IsIn(['true', 'false']) @IsOptional()
  MOCK_PROVIDERS: string = 'true';

  @IsString() @IsOptional()
  WX_APPID?: string;

  @IsString() @IsOptional()
  WX_SECRET?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`env 校验失败: ${errors.toString()}`);
  }
  return validated;
}
