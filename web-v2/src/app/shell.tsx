import { useEffect, useRef, useState } from 'react';
import type { AuthMe, Profile } from '../../../contracts/v2.ts';
import type { BootstrapDTO, CatalogDTO } from '../../../contracts/catalog.ts';
import { Avatar, Emblem, Modal, Notice, PageHeading } from '../components/ui.tsx';
import { AccountPage } from '../features/account/account.tsx';
import { CreateRoom } from '../features/room/create.tsx';
import { EnterRoom } from '../features/room/enter.tsx';
import { Lobby } from '../features/room/lobby.tsx';
import { GameScene } from '../features/game/scene.tsx';
import { ReviewPage } from '../features/review/page.tsx';
import { useRoomSession } from '../features/room/session.ts';
import { VoiceBar } from '../features/voice/bar.tsx';
import type { RoomReference } from '../features/room/session.ts';
import { roomPhaseLabels } from '../presentation/labels.ts';
import { ApiFailure, errorMessage, get, post } from '../transport/http.ts';
import type { MyRooms, RoomEntry } from '../transport/types.ts';
import { navigate, useRoute } from './navigation.ts';
import { DeathNotice } from '../features/game/death-notice.tsx';

export function AuthenticatedShell({ profile, bootstrap, catalog, onProfile, onLogout }: {
  profile: AuthMe; bootstrap: BootstrapDTO; catalog: CatalogDTO; onProfile: (profile: Profile) => void; onLogout: () => void;
}) {
  const [rooms, setRooms] = useState<MyRooms | null>(null);
  const [reference, setReference] = useState<RoomReference | null>(null);
  const [fetchingRooms, setFetchingRooms] = useState(true);
  const [notice, setNotice] = useState(''), [failure, setFailure] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false), [logoutConfirm, setLogoutConfirm] = useState(false);
  const route = useRoute();
  const roomCode = /^\/room\/([a-z2-9]{6})$/i.exec(route)?.[1]?.toUpperCase() ?? null;
  const generation = useRef(0), roomRequest = useRef(0);
  const roomRoot = useRef<HTMLDivElement>(null);
  const onExit = (message: string) => {
    roomRequest.current++; setReference(null); setNotice(message); setFailure(''); navigate('/'); void refreshRooms();
  };
  const session = useRoomSession(profile.userId, reference, bootstrap, { onExpired: onLogout, onExit });
  const refreshRooms = async () => {
    const requestNumber = ++roomRequest.current, ticket = generation.current;
    setFetchingRooms(true);
    try {
      const result = await get<MyRooms>('/me/rooms');
      if (ticket !== generation.current || requestNumber !== roomRequest.current) return;
      setRooms(result);
      const here = result.rooms.find(room => room.roomId === result.currentRoomId && room.activeHere);
      setReference(current => here ? current?.roomId === here.roomId ? current : { roomId: here.roomId, roomCode: here.roomCode } : null);
    } catch (error) {
      if (ticket !== generation.current || requestNumber !== roomRequest.current) return;
      if (error instanceof ApiFailure && error.code === 'unauthorized') onLogout(); else setFailure(errorMessage(error));
    } finally { if (ticket === generation.current && requestNumber === roomRequest.current) setFetchingRooms(false); }
  };
  useEffect(() => {
    generation.current++;
    void refreshRooms();
    return () => { generation.current++; roomRequest.current++; };
  }, [profile.userId]);
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible') void refreshRooms(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [profile.userId]);
  const entered = (entry: RoomEntry) => {
    roomRequest.current++; setReference({ roomId: entry.roomId, roomCode: entry.roomCode }); setNotice(''); setFailure('');
    navigate(`/room/${entry.roomCode}`); void refreshRooms();
  };
  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true); setFailure(''); const ticket = generation.current;
    try { await post('/auth/logout', {}); if (ticket === generation.current) { navigate('/'); onLogout(); } }
    catch (error) {
      if (ticket !== generation.current) return;
      if (error instanceof ApiFailure && error.code === 'unauthorized') onLogout(); else { setLogoutConfirm(false); setFailure(errorMessage(error)); }
    } finally { if (ticket === generation.current) setLogoutBusy(false); }
  };
  const current = rooms?.rooms.find(room => room.roomId === rooms.currentRoomId);
  const checkingRooms = fetchingRooms || rooms === null;
  const blockedOtherRoom = !!current && current.roomCode !== roomCode;
  const isRoomPage = roomCode !== null;
  const selected = route === '/account' ? 'account' : route === '/create' ? 'create' : route === '/join' || isRoomPage ? 'room' : 'home';
  const goHome = () => { navigate('/'); void refreshRooms(); };
  const roomVisible = isRoomPage && reference?.roomCode === roomCode;
  const roomView = session.view;
  const lobbyLayout = roomVisible && roomView?.room.phase === 'lobby' ? 'home-layout--lobby' : '';
  const roomKey = roomView ? [roomView.roomId, roomView.gameId, roomView.viewer.memberId, roomView.viewer.kind, roomView.viewer.subjectPlayerId, roomView.viewer.readOnly].join('/') : '';
  const roomContent = roomView ? roomView.room.phase === 'playing' && roomView.public
    ? <GameScene key={roomKey} active={roomVisible} view={roomView} catalog={catalog} online={session.canWrite} remaining={session.remaining} refresh={session.refresh} onExit={onExit} onExpired={onLogout}/>
    : roomView.room.phase === 'review'
      ? <ReviewPage key={roomKey} active={roomVisible} view={roomView} catalog={catalog} online={session.canWrite} remaining={session.remaining} refresh={session.refresh} onExit={onExit} onExpired={onLogout}/>
      : <Lobby key={roomKey} active={roomVisible} view={roomView} catalog={catalog} online={session.canWrite} remaining={session.remaining} refresh={session.refresh} onExit={onExit} onExpired={onLogout}/>
    : <p role="status">正在读取当前房间…</p>;
  return <main className={`home-layout ${lobbyLayout} ${isRoomPage ? 'home-layout--room' : ''} ${roomVisible && roomView?.room.phase === 'playing' ? 'home-layout--playing' : ''}`}><aside className="navigation"><div className="brand"><Emblem/><span>剧院死神<small>THEATER DEATH</small></span></div>
    <nav aria-label="主导航"><button className={`nav-item ${selected === 'home' ? 'active' : ''}`} onClick={goHome}>剧院首页</button><button className={`nav-item ${selected === 'room' ? 'active' : ''}`} onClick={() => navigate(reference ? `/room/${reference.roomCode}` : current ? `/room/${current.roomCode}` : '/join')}>我的房间</button><button className={`nav-item ${selected === 'account' ? 'active' : ''}`} onClick={() => navigate('/account')}>我的账户</button></nav>
    <div className="nav-profile"><Avatar url={profile.avatarUrl} name={profile.nickname}/><span title={`${profile.nickname} · UID ${profile.uid}`}>{profile.nickname}</span><button className="text-button" disabled={logoutBusy} onClick={() => { if (reference) setLogoutConfirm(true); else void logout(); }}>退出登录</button></div></aside>
    <section className="home-main">
      {failure && <Notice error>{failure}</Notice>}
      {notice && <Notice>{notice}<button className="text-button" onClick={() => setNotice('')}>知道了</button></Notice>}
      <VoiceBar enabled={bootstrap.features.voice} view={roomView} online={session.canWrite} activePage={roomVisible && roomView?.room.phase === 'playing'}/>
      {selected === 'account' ? <AccountPage profile={profile} bootstrap={bootstrap} onProfile={onProfile} onExpired={onLogout}/> : route === '/create' ?
        <CreateRoom userId={profile.userId} catalog={catalog} bootstrap={bootstrap} blocked={!!rooms?.currentRoomId} loading={checkingRooms} onCreated={entered} onExpired={onLogout} onBack={goHome}/> : roomVisible ? null : selected === 'room' ? <EnterRoom key={roomCode ?? 'join'} userId={profile.userId} initialCode={roomCode ?? ''} blocked={blockedOtherRoom} loading={checkingRooms} onEntered={entered} onExpired={onLogout} onBack={goHome}/> : <>
          <PageHeading eyebrow="THE FOYER" title="下一场，等你入席。">每一张面孔，都有尚未揭晓的故事。</PageHeading><div className="home-hero"><span className="eyebrow">THEATER DEATH</span><h2>幕布之后，<br/>真相尚未落定。</h2><p>与同伴一起，开启一场新的演出。</p><div className="button-row">{current ? <button className="button button--primary" disabled={fetchingRooms} onClick={() => navigate(`/room/${current.roomCode}`)}>{current.phase === 'lobby' ? '返回当前房间' : current.phase === 'review' ? '查看当前复盘' : '继续对局'}</button> : <><button className="button button--primary" disabled={checkingRooms} onClick={() => navigate('/join')}>加入房间</button><button className="button" disabled={checkingRooms} onClick={() => navigate('/create')}>创建房间</button></>}</div></div>
          <section className="panel"><div className="section-title"><h2>你的房间</h2><button className="text-button" disabled={fetchingRooms} onClick={() => void refreshRooms()}>刷新</button></div>{rooms === null ? <p role="status">{failure ? '当前房间状态尚未确认，请刷新。' : '正在读取房间…'}</p> : rooms.rooms.length ? <div className="room-list">{rooms.rooms.map(room => <div className="room-list__item" key={room.roomId}><div><strong>房间 {room.roomCode}</strong><p className="muted">{roomPhaseLabels[room.phase]} · {room.kind === 'formal' || room.canRecover ? '玩家身份' : '观战身份'}</p></div><button className="button" disabled={fetchingRooms || !!current && current.roomId !== room.roomId} onClick={() => navigate(`/room/${room.roomCode}`)}>{room.requiresTakeover ? '前往接管' : room.activeHere ? '返回房间' : '恢复身份'}</button></div>)}</div> : <p className="muted">目前没有进行中的房间。创建一场演出，或输入同伴的房间码。</p>}</section>
        </>}
      {reference && <div ref={roomRoot} className="room-session-content" hidden={!roomVisible}>
        <DeathNotice view={roomView} online={session.canWrite} active={roomVisible} rootRef={roomRoot}/>
        {session.connection !== 'online' && <Notice>连接{session.connection === 'connecting' ? '中' : '已中断，信息可能不是最新'}。<button className="text-button" onClick={() => void session.refresh()}>重新同步</button></Notice>}
        {session.notice && <Notice>{session.notice}</Notice>}
        {roomContent}
      </div>}
    </section>
    {logoutConfirm && <Modal title="退出当前登录？" onClose={() => setLogoutConfirm(false)} dismissible={!logoutBusy}><p>本设备将退出登录并离开当前房间连接。正在进行的对局不会暂停，原玩家再次进入时按服务端状态恢复本人席位。</p><div className="button-row"><button className="button" disabled={logoutBusy} onClick={() => setLogoutConfirm(false)}>取消</button><button className="button button--primary" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? '正在退出…' : '确认退出登录'}</button></div></Modal>}
  </main>;
}
