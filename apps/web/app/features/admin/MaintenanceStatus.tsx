import type { MaintenanceOverview } from '@aihot/industry/maintenance';
import { bj } from './format';
import { Badge, Card, Stat } from './ui';

const LABELS: Record<MaintenanceOverview['state'], string> = {
  healthy: '运行正常', degraded: '需要处理', offline: '维护服务离线', 'not-started': '尚无维护记录', unavailable: '状态读取失败',
};
const when = (at: string | null) => at ? bj(at, true) : '暂无记录';

export function MaintenanceStatus({ value: m }: { value: MaintenanceOverview }) {
  return <div aria-label="站点与本地备份" data-state={m.state} className="mb-5">
    <Card title="站点与本地备份" right={<Badge tone={m.state === 'healthy' ? 'ok' : m.state === 'not-started' ? 'muted' : 'warn'}>{LABELS[m.state]}</Badge>}>
      <p className="mb-3 text-[13px] text-ink-3">维护服务独立于内容 worker；仅浏览或授权到期时，仍可检查站点并保存本地备份。</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="网站与数据库" value={<span className="text-[17px]">{m.websiteOk === null ? '尚未检查' : m.websiteOk ? '上次检查正常' : '上次检查异常'}</span>} hint={`检查 ${when(m.checkedAt)}`} />
        <Stat label="最近成功备份" value={<span className="text-[17px]">{m.lastBackupAt ? '已有本地副本' : '暂无成功备份'}</span>} hint={when(m.lastBackupAt)} />
        <Stat label="最近备份尝试" value={<span className="text-[17px]">{m.backupOk === null ? '尚未执行' : m.backupOk ? '成功' : '失败，等待重试'}</span>} hint={m.backupBytes === null ? '数据库与上传文件' : `数据库归档 ${(m.backupBytes / 1048576).toFixed(1)} MB`} />
        <Stat label="下次备份检查" value={<span className="text-[17px]">{m.nextBackupAt ? '按计划检查' : '等待维护服务'}</span>} hint={when(m.nextBackupAt)} />
      </div>
      <p className="mt-3 text-[12px] text-ink-4">默认每 5 分钟检查，成功备份间隔 24 小时，失败后 1 小时重试。本地副本位于宿主目录，尚未接入异地存储；查询不启动模型或内容处理。</p>
    </Card>
  </div>;
}
