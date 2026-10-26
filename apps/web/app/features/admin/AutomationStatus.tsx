import type { AutomationOverview } from '@aihot/industry/automation';
import { bj, num } from './format';
import { Badge, Card, Stat } from './ui';

export const AUTOMATION_LABELS: Record<AutomationOverview['state'], string> = {
  running: '自动运行中', 'budget-waiting': '等待额度恢复', expired: '授权已到期', stopped: '已主动停止',
  offline: '异常离线', 'not-started': '尚未开始', 'budget-changed': '预算变更待核对', 'unexpected-worker': '运行入口异常',
};
const DAILY_LABELS: Record<AutomationOverview['daily']['state'], string> = {
  published: '已发布', 'no-materials': '暂无合格材料', 'budget-waiting': '等待共享额度', failed: '报告检查失败', waiting: '等待处理',
};
export const automationTone = (state: AutomationOverview['state']) => state === 'running' ? 'ok' as const
  : ['offline', 'unexpected-worker'].includes(state) ? 'bad' as const
  : ['budget-waiting', 'budget-changed'].includes(state) ? 'warn' as const : 'muted' as const;
const when = (at: string | null) => at ? bj(at, true) : '暂无记录';

export function AutomationStatus({ value: a }: { value: AutomationOverview }) {
  return <div aria-label="受限自动运行概览" data-state={a.state} className="mb-5">
    <Card title="受限自动运行" right={<Badge tone={automationTone(a.state)}>{AUTOMATION_LABELS[a.state]}</Badge>}>
      <p className="mb-3 text-[13px] text-ink-3">授权截止 {when(a.expiresAt)}{a.retryAt ? ` · 额度下次检查 ${when(a.retryAt)}` : ''}。查询不会启动采集或模型调用。</p>
      {a.state === 'unexpected-worker' && <p className="mb-3 text-[13px] text-hot">检测到的活跃 worker 未使用受限入口，请先核对启动方式。试运行到期保护不代表普通 worker 已停止。</p>}
      {a.state === 'budget-changed' && <p className="mb-3 text-[13px] text-amber">当前预算与授权快照不一致，受限任务会停止新工作；请核对后台预算，不要直接重启或续期。</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="共享请求额度" value={a.budget ? `${a.budget.per_minute} / ${a.budget.per_hour} / ${a.budget.per_day}` : '未配置'} hint="每分钟 / 每小时 / 滚动24小时" />
        <Stat label="滚动24小时请求" value={num(a.requests24h)} hint="包含实际重试，共享于各模型步骤" />
        <Stat label="费用尚未记录" value={num(a.unknownCostAttempts)} hint="本次开始后的请求尝试；请核对提供商账单" />
        <Stat label={`日报 · ${a.daily.key}`} value={<span className="text-[17px]">{DAILY_LABELS[a.daily.state]}</span>} hint={`${a.daily.candidates} 条未重复的合格材料 · 检查 ${when(a.daily.checkedAt)}`} />
      </div>
      <dl className="mt-4 grid gap-2 text-[12.5px] text-ink-3 sm:grid-cols-2">
        <div><dt className="inline">最近采集成功：</dt><dd className="inline">{when(a.lastCollectedAt)}</dd></div>
        <div><dt className="inline">最近文章公开更新：</dt><dd className="inline">{when(a.lastPublicAt)}</dd></div>
        <div><dt className="inline">最近模型请求：</dt><dd className="inline">{when(a.lastRequestAt)}</dd></div>
        <div><dt className="inline">受限流程最近一轮：</dt><dd className="inline">{when(a.lastTickAt)}</dd></div>
      </dl>
      <p className="mt-3 text-[12.5px] text-ink-3">当前14天候选 {num(a.pipeline.recent_candidates ?? 0)} · 待分析 {num(a.pipeline.ready_for_analysis ?? 0)} · 待正文 {num(a.pipeline.waiting_for_body ?? 0)} · 预筛拦截 {num(a.pipeline.blocked ?? 0)} · 已放行精选 {num(a.pipeline.selected_released ?? 0)} · 普通公开 {num(a.pipeline.ordinary_public ?? 0)}。</p>
      <p className="mt-1 text-[12px] text-ink-4">以上排除历史补录，仅统计当前合格白名单；等待重试可与其他阶段重叠。{a.missingSources > 0 ? `另有 ${a.missingSources} 个白名单入口尚未安装。` : ''}下方普通队列由另一入口消费，不代表受限流程积压。</p>
    </Card>
  </div>;
}
