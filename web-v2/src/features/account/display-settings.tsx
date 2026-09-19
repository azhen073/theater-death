import { usePreferences } from '../../state/preferences.ts';
import type { DisplayPreferences } from '../../state/preferences.ts';

export function DisplaySettings() {
  const { preferences, update, saved } = usePreferences();
  return <section className="panel" aria-label="显示与动画设置"><h2>显示与动画</h2><p className="muted">保存在当前浏览器，切换账号后继续使用。</p>
    <label className="select-field">动画偏好<select aria-label="动画偏好" value={preferences.motion} onChange={event => update({ motion: event.target.value as DisplayPreferences['motion'] })}><option value="system">跟随系统</option><option value="reduced">减少动画</option><option value="full">标准动画</option></select></label>
    <label className="setting-row"><span>死亡特效<small className="muted">只在新的公开死讯后显示，不影响行动和记录。</small></span><input type="checkbox" checked={preferences.deathEffects} onChange={event => update({ deathEffects: event.target.checked })}/></label>
    <label className="select-field">界面缩放<select aria-label="界面缩放" value={preferences.scale} onChange={event => update({ scale: Number(event.target.value) as DisplayPreferences['scale'] })}><option value={90}>紧凑 · 90%</option><option value={100}>标准 · 100%</option><option value={110}>放大 · 110%</option></select></label>
    {!saved && <p role="status">设置已在当前页面生效；浏览器未允许保存，刷新后可能恢复默认。</p>}
  </section>;
}
