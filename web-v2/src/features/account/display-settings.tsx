import { usePreferences } from '../../state/preferences.ts';
import type { DisplayPreferences } from '../../state/preferences.ts';

export function DisplaySettings({ showStageBrightness = false }: { showStageBrightness?: boolean }) {
  const { preferences, update, saved } = usePreferences();
  return <section className="panel display-settings" aria-label="显示与动画设置"><h2>显示与动画</h2><p className="muted">保存在当前浏览器，切换账号后继续使用。</p>
    <label className="select-field">动画偏好<select aria-label="动画偏好" value={preferences.motion} onChange={event => update({ motion: event.target.value as DisplayPreferences['motion'] })}><option value="system">跟随系统</option><option value="reduced">减少动画</option><option value="full">标准动画</option></select></label>
    <label className="setting-row"><span>死亡特效<small className="muted">只在新的公开死讯后显示，不影响行动和记录。</small></span><input type="checkbox" aria-label="死亡特效" checked={preferences.deathEffects} onChange={event => update({ deathEffects: event.target.checked })}/></label>
    <label className="setting-row"><span>音量指示<small className="muted">显示自己与当前发言者的麦克风电平；只在本机可见，不上报、不入记录。</small></span><input type="checkbox" aria-label="音量指示" checked={preferences.voiceLevels} onChange={event => update({ voiceLevels: event.target.checked })}/></label>
    <label className="setting-row"><span>轮到我发言时自动开麦<small className="muted">进对局自动加入语音；轮到自己发言时自动打开麦克风，发言结束自动停麦。可在语音条随时关闭麦克风。</small></span><input type="checkbox" aria-label="轮到我发言时自动开麦" checked={preferences.autoMic} onChange={event => update({ autoMic: event.target.checked })}/></label>
    <label className="select-field">界面缩放<select aria-label="界面缩放" value={preferences.scale} onChange={event => update({ scale: Number(event.target.value) as DisplayPreferences['scale'] })}><option value={90}>紧凑 · 90%</option><option value={100}>标准 · 100%</option><option value={110}>放大 · 110%</option></select></label>
    {showStageBrightness && <div className="stage-brightness-setting">
      <label>舞台背景亮度 <output>{preferences.stageBrightness}%</output>
        <input type="range" aria-label="舞台背景亮度" min={50} max={130} step={1} value={preferences.stageBrightness} onChange={event => update({ stageBrightness: Number(event.target.value) })}/>
      </label>
      <small className="muted">仅调整日间与夜间背景，不影响头像、文字和行动按钮。保存后所有房间沿用。</small>
      <button type="button" className="text-button" onClick={() => update({ stageBrightness: 100 })}>恢复默认亮度</button>
    </div>}
    {!saved && <p role="status">设置已在当前页面生效；浏览器未允许保存，刷新后可能恢复默认。</p>}
  </section>;
}
