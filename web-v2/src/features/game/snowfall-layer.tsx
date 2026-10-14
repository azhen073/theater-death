import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { makeSnowflakes, snowActive, snowflakeCount, snowSeed } from '../../presentation/snowfall.ts';
import { usePreferences } from '../../state/preferences.ts';
import '../../styles/snowfall.css';

/**
 * 二阶段整页飘雪。只读公开状态（阶段 / 昼夜 / 房间相位），不看私有任务或行动进度；
 * 减少动画、页面隐藏、离线或离场时整个运动层卸载。落点由 JS 测量一次图层自身高度，
 * 动画只走 transform，且在任何缩放/环形布局下都用图层本地坐标。
 */
export function SnowfallLayer({ view, active }: { view: RoomSnapshot; active: boolean }) {
  const { reducedMotion } = usePreferences();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  const on = snowActive(view) && active && visible && !reducedMotion;
  useLayoutEffect(() => {
    if (!on) return;
    const element = ref.current;
    if (!element) return;
    // 只在尺寸真的变化时更新：ResizeObserver 也会在父容器 display:none ↔ 显示之间报 0 与真实高度，
    // 因此「先隐藏、后在隐藏状态进入二阶段」也能在重新显示时补测到尺寸。
    const measure = () => setBox(current => {
      const width = element.clientWidth, height = element.clientHeight;
      return current.width === width && current.height === height ? current : { width, height };
    });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('orientationchange', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('orientationchange', schedule);
    };
  }, [on]);
  const flakes = useMemo(
    () => box.width > 0 && box.height > 0 ? makeSnowflakes(snowSeed(view), snowflakeCount(box.width, box.height)) : [],
    [box.width, box.height, view],
  );
  if (!on) return null;
  const fall = Math.round(box.height + 24);
  return <div
    ref={ref}
    className={`snowfall ${view.public?.phase === 'night' ? 'snowfall--night' : 'snowfall--day'}`}
    aria-hidden="true"
  >
    {flakes.map((flake, index) => <i key={index} style={{
      '--snow-x': `${(flake.left * 100).toFixed(3)}%`,
      '--snow-size': `${flake.size.toFixed(2)}px`,
      '--snow-fall': `${fall}px`,
      '--snow-mid': `${Math.round(fall / 2)}px`,
      '--snow-drift': `${flake.drift.toFixed(2)}px`,
      '--snow-sway': `${flake.sway.toFixed(2)}px`,
      '--snow-duration': `${Math.round(flake.duration)}ms`,
      '--snow-delay': `${Math.round(flake.delay)}ms`,
      '--snow-opacity': flake.opacity.toFixed(2),
    } as CSSProperties}/>)}
  </div>;
}
