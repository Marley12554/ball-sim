import { h, icon } from './dom';
import { audio } from './audio';

/** Speaker button: click toggles mute, the slider sets volume. */
export function soundButton(): HTMLElement {
  const btn = h('button', { class: 'icon-btn', 'aria-label': 'Sound' });
  const slider = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(audio.volume * 100)), class: 'vol', 'aria-label': 'Volume' });
  const wrap = h('div', { class: 'sound' }, btn, h('div', { class: 'vol-pop' }, slider));
  const paint = () => {
    btn.replaceChildren(icon(audio.muted ? 'mute' : 'sound'));
    btn.title = audio.muted ? 'Unmute' : 'Mute';
  };
  btn.addEventListener('click', () => { audio.unlock(); audio.setMuted(!audio.muted); });
  slider.addEventListener('input', () => { audio.unlock(); audio.setVolume(Number(slider.value) / 100); if (audio.muted) audio.setMuted(false); });
  const off = audio.onChange(paint);
  paint();
  const obs = new MutationObserver(() => { if (!wrap.isConnected) { off(); obs.disconnect(); } });
  setTimeout(() => obs.observe(document.body, { childList: true, subtree: true }));
  return wrap;
}
