import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** 按钮权限。已有库的 init.sql 不会重跑，启动时按编码补齐，并授给管理员。 */
const BUTTONS: Array<[string, string, string, string, number]> = [
  ['4000000000000000051', '4000000000000000021', '新建用户', 'system:user:create', 1],
  ['4000000000000000052', '4000000000000000021', '编辑用户', 'system:user:edit', 2],
  ['4000000000000000053', '4000000000000000021', '删除用户', 'system:user:delete', 3],
  ['4000000000000000054', '4000000000000000022', '新建角色', 'system:role:create', 1],
  ['4000000000000000055', '4000000000000000022', '配置角色权限', 'system:role:edit', 2],
  ['4000000000000000056', '4000000000000000024', '新建团队', 'system:team:create', 1],
  ['4000000000000000057', '4000000000000000024', '编辑团队', 'system:team:edit', 2],
  ['4000000000000000058', '4000000000000000024', '删除团队', 'system:team:delete', 3],
];

@Injectable()
export class PermissionSeedService implements OnModuleInit {
  private readonly logger = new Logger(PermissionSeedService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    for (const [id, parentId, name, code, sort] of BUTTONS) {
      await this.dataSource.query(
        `INSERT INTO kh_permission
          (id, parent_id, permission_name, permission_code, permission_type, sort, status, deleted)
         VALUES ($1, $2, $3, $4, 2, $5, 1, false)
         ON CONFLICT (permission_code) DO NOTHING`,
        [id, parentId, name, code, sort],
      );
    }
    const admin = await this.dataSource.query(
      `SELECT id FROM kh_role WHERE role_code = 'ROLE_ADMIN' AND status = 1 LIMIT 1`,
    );
    const adminId = admin[0]?.id as string | undefined;
    if (!adminId) {
      return;
    }
    let granted = 0;
    for (const [index, button] of BUTTONS.entries()) {
      const code = button[3];
      const linkId = String(4100000000000000301n + BigInt(index));
      const rows = await this.dataSource.query(
        `INSERT INTO kh_role_permission (id, role_id, permission_id)
         SELECT $1, $2, p.id
         FROM kh_permission p
         WHERE p.permission_code = $3 AND p.deleted = false
         ON CONFLICT (role_id, permission_id) DO NOTHING
         RETURNING id`,
        [linkId, adminId, code],
      );
      granted += rows.length;
    }
    if (granted > 0) {
      this.logger.log(`已为管理员补齐 ${granted} 个按钮权限`);
    }
  }
}
