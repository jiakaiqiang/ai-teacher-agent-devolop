import { IsString, Length } from 'class-validator';

// POST /api/auth/login 的请求体
export class LoginDto {
  @IsString()
  @Length(1, 64)
  username!: string;

  // 只限制长度上限：scrypt 处理超长输入很慢，不限制的话可以用一个 1MB 的“密码”拖慢服务器
  @IsString()
  @Length(1, 128)
  password!: string;
}
