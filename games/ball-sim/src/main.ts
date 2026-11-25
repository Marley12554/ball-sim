import './ui/styles.css';
import { mountGallery, MODE_COLOR } from './ui/gallery';
import { mountViewer } from './ui/viewer';
import { mountEditor } from './ui/editor/editor';
import { blankSim, fromCode, randomOf } from './sim/modes';
import { getSim, decodeShare, saveSim, newId } from './ui/store';
import { navigate } from './ui/router';
import { toast } from './ui/dom';
import { installUiSounds, audio } from './ui/audio';
import { prepareEnter } from './ui/transition';

installUiSounds();
const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;
let token = 0;

async function route() {
  const my = ++token;
  unmount?.();
  unmount = null;
  document.querySelectorAll('.menu, .pop, .modal-back').forEach((m) => m.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [kind, arg = ''] = parts;
  try {
    if (kind === 'g') {
      const gen = fromCode(arg);
      if (!gen) { toast('That code doesn’t match anything'); return navigate('#/'); }
      audio.ambience(0.5);
      unmount = mountViewer(root, {
        def: gen.def,
        title: `${gen.mode.name} · ${gen.mode.variants[gen.variant].name}`,
        code: gen.code,
        editHref: `#/edit/g:${gen.code}`,
        reroll: () => {
          const next = randomOf(gen.mode, gen.variant);
          prepareEnter(root, MODE_COLOR[gen.mode.id] ?? '#FFFFFF', root.querySelector('canvas'));
          navigate(`#/g/${next.code}`);
        },
      });
    } else if (kind === 'm') {
      const s = getSim(arg);
      if (!s) return navigate('#/');
      unmount = mountViewer(root, { def: s.def, title: s.def.name, editHref: `#/edit/${arg}` });
    } else if (kind === 's') {
      const def = await decodeShare(arg);
      if (my !== token) return;
      unmount = mountViewer(root, { def, title: def.name, editHref: `#/edit/s:${arg}` });
    } else if (kind === 'edit') {
      audio.ambience(0.25);
      if (arg === 'new') {
        unmount = mountEditor(root, { def: blankSim(), id: null, playHref: '#/' });
      } else if (arg.startsWith('g:')) {
        const gen = fromCode(arg.slice(2));
        if (!gen) return navigate('#/');
        unmount = mountEditor(root, { def: gen.def, id: null, playHref: `#/g/${gen.code}` });
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
      audio.ambience(0.55);
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
