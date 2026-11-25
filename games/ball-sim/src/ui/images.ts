import { h, icon, iconButton, toast } from './dom';
import { uploadImage } from './editor/look';

/** Your images: uploads kept in this browser, usable as ball looks in any simulation. */
const KEY = 'ballsim.images.v1';

export interface LibImage { id: string; data: string }

export function loadImages(): LibImage[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveImages(list: LibImage[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function addImage(data: string): string {
  const id = `lib${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const list = loadImages();
  list.push({ id, data });
  if (!saveImages(list)) toast('Browser storage is full');
  return id;
}

export function removeImage(id: string): void {
  saveImages(loadImages().filter((i) => i.id !== id));
}

export function openImagesModal(): void {
  document.querySelector('.modal-back')?.remove();
  const grid = h('div', { class: 'lib-grid' });
  const close = () => back.remove();
  const render = () => {
    const list = loadImages();
    grid.replaceChildren(
      ...list.map((img) => h('div', { class: 'lib-item' },
        h('img', { src: img.data, alt: '' }),
        iconButton('trash', 'Remove', () => { removeImage(img.id); render(); }, 'lib-del'))),
      h('button', { class: 'lib-add', title: 'Upload image', onclick: async () => { const id = await uploadImage(addImage); if (id) render(); } }, icon('plus', 22)),
    );
  };
  render();
  const back = h('div', { class: 'modal-back', onclick: (e: MouseEvent) => { if (e.target === back) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Your images' },
      h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, 'Your images'), iconButton('close', 'Close', close)),
      h('p', { class: 'modal-note' }, 'Pick these as a ball’s look in the editor. They’re saved in this browser.'),
      grid));
  document.body.append(back);
}
