import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BootstrapDTO } from '../../../../contracts/catalog.ts';
import type { AuthMe, Profile } from '../../../../contracts/v2.ts';
import { Modal, Notice } from '../../components/ui.tsx';
import { ApiFailure, UnknownResult, errorMessage, get, request } from '../../transport/http.ts';
import { isAnimatedImage, squareCrop } from './image-input.ts';

type ImageSource = { url: string; image: HTMLImageElement; width: number; height: number };
export function AvatarEditor({ limits, userId, onSave, onClose, onExpired }: {
  limits: BootstrapDTO['avatar']; userId: string; onSave: (profile: Profile) => void; onClose: () => void; onExpired: () => void;
}) {
  const [source, setSource] = useState<ImageSource | null>(null);
  const [zoom, setZoom] = useState(1), [x, setX] = useState(0), [y, setY] = useState(0);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  const select = async (file: File | undefined) => {
    if (!file) return;
    const ticket = ++generation.current;
    setError(''); setSource(null); setLoading(true);
    let url: string | null = null;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 静态图片。');
      if (file.size > limits.maxBytes) throw new Error(`图片超过 ${(limits.maxBytes / 1048576).toFixed(0)} MiB，请先压缩。`);
      if (isAnimatedImage(new Uint8Array(await file.arrayBuffer()), file.type)) throw new Error('暂不支持动画头像，请选择静态图片。');
      url = URL.createObjectURL(file);
      const image = new Image(); image.src = url; await image.decode();
      if (generation.current !== ticket) { URL.revokeObjectURL(url); return; }
      if (image.naturalWidth > limits.maxDimension || image.naturalHeight > limits.maxDimension) throw new Error(`图片边长不能超过 ${limits.maxDimension} 像素。`);
      setSource({ url, image, width: image.naturalWidth, height: image.naturalHeight }); setZoom(1); setX(0); setY(0);
    } catch (failure) {
      if (url) URL.revokeObjectURL(url);
      if (generation.current === ticket) setError(failure instanceof Error && failure.name !== 'EncodingError' ? failure.message : '无法读取这张图片，请重新选择。');
    } finally { if (generation.current === ticket) setLoading(false); }
  };
  const save = async () => {
    if (!source || busy) return;
    setBusy(true); setError(''); const ticket = generation.current;
    try {
      const crop = squareCrop(source.width, source.height, zoom, x, y);
      const canvas = document.createElement('canvas'); canvas.width = limits.outputSize; canvas.height = limits.outputSize;
      const context = canvas.getContext('2d'); if (!context) throw new Error('canvas_unavailable');
      context.drawImage(source.image, crop.left, crop.top, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode_failed')), 'image/webp', .9));
      const profile = await request<Profile>('/me/avatar', { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
      if (ticket === generation.current && profile.userId === userId) { onSave(profile); onClose(); }
    } catch (failure) {
      if (ticket !== generation.current) return;
      if (failure instanceof ApiFailure && failure.code === 'unauthorized') { onExpired(); return; }
      if (failure instanceof UnknownResult) {
        try {
          const profile = await get<AuthMe>('/auth/me');
          if (ticket === generation.current && profile.userId === userId) onSave(profile);
        } catch (refreshError) {
          if (ticket === generation.current && refreshError instanceof ApiFailure && refreshError.code === 'unauthorized') { onExpired(); return; }
        }
      }
      if (ticket === generation.current) setError(errorMessage(failure));
    } finally { if (ticket === generation.current) setBusy(false); }
  };
  const crop = source ? squareCrop(source.width, source.height, zoom, x, y) : null;
  const preview: CSSProperties = source && crop ? { backgroundImage: `url(${source.url})`, backgroundSize: `${source.width / crop.size * 100}% ${source.height / crop.size * 100}%`, backgroundPosition: `${(x + 1) * 50}% ${(y + 1) * 50}%` } : {};
  return <Modal title="更换头像" onClose={onClose} dismissible={!busy}>
    <p className="muted">选择静态 JPEG / PNG / WebP，最大 {(limits.maxBytes / 1048576).toFixed(0)} MiB；裁剪为正方形后保存。</p>
    <label className="upload-button">选择图片<input aria-label="选择头像图片" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { void select(event.target.files?.[0]); event.target.value = ''; }}/></label>
    {loading && <p role="status">正在读取图片…</p>}
    {source && <><div className="avatar-crop" style={preview} role="img" aria-label="裁剪后的头像预览"/>
      <fieldset disabled={busy}><label className="range-field">缩放<input aria-label="头像缩放" type="range" min="1" max="4" step=".05" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label>
        <label className="range-field">水平位置<input aria-label="头像水平位置" type="range" min="-1" max="1" step=".02" value={x} onChange={event => setX(Number(event.target.value))}/></label>
        <label className="range-field">垂直位置<input aria-label="头像垂直位置" type="range" min="-1" max="1" step=".02" value={y} onChange={event => setY(Number(event.target.value))}/></label></fieldset></>}
    {error && <Notice error>{error}</Notice>}
    <div className="button-row"><button className="button" disabled={busy} onClick={onClose}>取消</button><button className="button button--primary" disabled={!source || loading || busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存头像'}</button></div>
  </Modal>;
}
