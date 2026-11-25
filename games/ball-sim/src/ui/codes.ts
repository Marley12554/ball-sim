import { parseCode } from '../sim/modes';
import { navigate } from './router';
import { toast } from './dom';

/** Open whatever the person typed: a short code, a long share code, or a full link. */
export function openCode(input: string): void {
  const s = input.trim();
  const hash = s.includes('#/') ? s.slice(s.indexOf('#/')) : null;
  if (hash) { navigate(hash); return; }
  if (parseCode(s)) { navigate(`#/g/${s.toUpperCase()}`); return; }
  if (/^[zj][A-Za-z0-9_-]{8,}$/.test(s)) { navigate(`#/s/${s}`); return; }
  toast('That code doesn’t match anything');
}
