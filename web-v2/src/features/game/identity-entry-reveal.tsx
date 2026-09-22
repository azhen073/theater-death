import { useEffect, useId, useRef } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { authorizedPrivate } from './identity.tsx';

export function IdentityEntryReveal({ view, catalog, onEnter }: {
  view: RoomSnapshot;
  catalog: CatalogDTO;
  onEnter: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const privateView = authorizedPrivate(view);
  const role = catalog.roles.find(item => item.roleId === privateView?.self.roleId);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  if (!privateView || !role) return null;
  const faction = role.faction === 'human' ? '人类阵营' : role.faction === 'death_faction' ? '死神阵营' : '';
  return <dialog
    ref={dialogRef}
    className="modal identity-entry-reveal"
    aria-labelledby={titleId}
    onCancel={event => event.preventDefault()}
  >
    <div className="identity-entry-reveal__heading">
      <span className="eyebrow">本局身份</span>
      <h2 id={titleId}>{role.name}</h2>
      <p>{faction} · {privateView.self.seat}号席位</p>
    </div>
    <img className="identity-entry-reveal__card" src={`/assets/cards/${role.roleId}.png`} alt={`${role.name}身份卡`} />
    <p className="identity-entry-reveal__description">{role.description}</p>
    <button type="button" className="button button--primary identity-entry-reveal__enter" autoFocus onClick={onEnter}>
      进入舞台
    </button>
  </dialog>;
}
