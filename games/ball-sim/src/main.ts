import './ui/styles.css';
import { mountGallery } from './ui/gallery';
import { mountViewer } from './ui/viewer';
import { mountEditor } from './ui/editor/editor';
import { PRESETS, blankSim } from './sim/presets';
import { getSim, decodeShare, saveSim, newId } from './ui/store';
import { navigate } from './ui/router';
import { toast } from './ui/dom';

const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;
let token = 0;

async function route() {
  const my = ++token;
  unmount?.();
  unmount = null;
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [kind, arg = ''] = parts;
  try {
    if (kind === 'p') {
      const p = PRESETS.find((x) => x.id === arg);
      if (!p) return navigate('#/');
      unmount = mountViewer(root, { def: p.make(), editHref: `#/edit/p:${arg}` });
    } else if (kind === 'm') {
      const s = getSim(arg);
      if (!s) return navigate('#/');
      unmount = mountViewer(root, { def: s.def, editHref: `#/edit/${arg}` });
    } else if (kind === 's') {
      const def = await decodeShare(arg);
      if (my !== token) return;
      unmount = mountViewer(root, { def, editHref: `#/edit/s:${arg}` });
    } else if (kind === 'edit') {
      if (arg === 'new') {
        unmount = mountEditor(root, { def: blankSim(), id: null, playHref: '#/' });
      } else if (arg.startsWith('p:')) {
        const id = arg.slice(2);
        const p = PRESETS.find((x) => x.id === id);
        if (!p) return navigate('#/');
        unmount = mountEditor(root, { def: p.make(), id: null, playHref: `#/p/${id}` });
      } else if (arg.startsWith('s:')) {
        const def = await decodeShare(arg.slice(2));
        if (my !== token) return;
        const id = newId();
        saveSim(id, def);
        history.replaceState(null, '', `#/edit/${id}`);
        unmount = mountEditor(root, { def, id, playHref: `#/m/${id}` });
      } else {
        const s = getSim(arg);
        if (!s) return navigate('#/');
        unmount = mountEditor(root, { def: s.def, id: arg, playHref: `#/m/${arg}` });
      }
    } else {
      unmount = mountGallery(root);
    }
  } catch (e) {
    console.error(e);
    toast('That link didn’t open');
    if (kind) navigate('#/');
  }
}

window.addEventListener('hashchange', route);
route();
