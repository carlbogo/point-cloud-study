export type AccessContext = { invite: string; team_key: string };
export function parseAccessLink(address: string): AccessContext | null {
  const url = new URL(address);
  const path = url.pathname.match(/^\/(join|team)\/([^/]+)\/?$/);
  const fragment = new URLSearchParams(url.hash.slice(1));
  let kind: 'invite' | 'team' | null = null;
  let value = '';
  if (path) {
    kind = path[1] === 'join' ? 'invite' : 'team';
    value = decodeURIComponent(path[2]);
  } else if (url.pathname.startsWith('/join') || url.pathname.startsWith('/team')) {
    throw new Error(
      'This link is incomplete. Ask the organiser to copy the complete invitation link.',
    );
  } else if (fragment.has('team') || fragment.has('invite')) {
    kind = fragment.has('team') ? 'team' : 'invite';
    value = fragment.get(kind) || '';
  } else if (url.searchParams.has('team') || url.searchParams.has('invite')) {
    kind = url.searchParams.has('team') ? 'team' : 'invite';
    value = url.searchParams.get(kind) || '';
  }
  if (!kind) return null;
  if (!/^[a-zA-Z0-9_-]{32,100}$/.test(value)) {
    throw new Error(
      'This invitation link is incomplete or malformed. Ask the organiser for the complete link.',
    );
  }
  return kind === 'team' ? { invite: '', team_key: value } : { invite: value, team_key: '' };
}
