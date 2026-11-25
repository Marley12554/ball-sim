import { CTX_SELF, CTX_OTHER } from '@engine/index';
import type { FilterBlock } from './types';
import { BODY_PROPS, CMP, cmpSym, compare } from './types';

export const chance: FilterBlock = {
  type: 'chance', category: 'filter', label: 'Chance',
  params: [{ key: 'percent', label: 'Chance', type: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%' }],
  summary: (p) => `${p.percent}%`,
  test: (sim, n) => sim.rng.next() * 100 < Number(n.params.percent),
};

export const onlyIf: FilterBlock = {
  type: 'onlyIf', category: 'filter', label: 'Only if',
  params: [
    {
      key: 'subject', label: 'Of', type: 'enum', default: 'self',
      options: [{ value: 'self', label: 'Self', needs: CTX_SELF }, { value: 'other', label: 'Other', needs: CTX_OTHER }],
    },
    { key: 'prop', label: 'Value', type: 'enum', default: 'speed', options: [...BODY_PROPS, { value: 'impact', label: 'Impact speed' }] },
    { ...CMP, default: 'above' },
    { key: 'value', label: 'Than', type: 'number', default: 100, min: -1e9, max: 1e9, step: 1 },
  ],
  summary: (p) => `${p.subject} ${p.prop} ${cmpSym(p.cmp)} ${p.value}`,
  test(sim, n, e) {
    const p = n.params;
    const v = p.prop === 'impact' ? e.speed : sim.prop(p.subject === 'other' ? e.other : e.self, p.prop);
    return v === v && compare(v, p.cmp, Number(p.value));
  },
};

export const otherIs: FilterBlock = {
  type: 'otherIs', category: 'filter', label: 'Only if other',
  params: [
    {
      key: 'mode', label: 'Is', type: 'enum', default: 'different',
      options: [
        { value: 'different', label: 'Other group', needs: CTX_SELF | CTX_OTHER },
        { value: 'same', label: 'Same group', needs: CTX_SELF | CTX_OTHER },
        { value: 'in', label: 'In', needs: CTX_OTHER },
        { value: 'notIn', label: 'Not in', needs: CTX_OTHER },
      ],
    },
    { key: 'group', label: 'Group', type: 'ref', refKinds: ['ball', 'ring', 'wall', 'track', 'zone'], default: '', showIf: (p) => p.mode === 'in' || p.mode === 'notIn' },
  ],
  summary: (p, name) => (p.mode === 'in' ? `is ${name(p.group)}` : p.mode === 'notIn' ? `isn't ${name(p.group)}` : p.mode === 'same' ? 'same group' : 'other group'),
  test(sim, n, e) {
    const go = sim.groupOfRef(e.other);
    if (go < 0) return false;
    const p = n.params;
    if (p.mode === 'in' || p.mode === 'notIn') {
      const g = sim.groupByNode.get(p.group);
      return p.mode === 'in' ? go === g : go !== g;
    }
    const gs = sim.groupOfRef(e.self);
    return p.mode === 'same' ? go === gs : go !== gs;
  },
};

export const everyNth: FilterBlock = {
  type: 'everyNth', category: 'filter', label: 'Every Nth',
  params: [{ key: 'n', label: 'N', type: 'int', default: 3, min: 1, max: 100000, step: 1 }],
  summary: (p) => `every ${p.n}`,
  test(_sim, n) {
    n.counter++;
    return n.counter % Math.max(1, Number(n.params.n) | 0) === 0;
  },
};

export const FILTER_BLOCKS: FilterBlock[] = [chance, onlyIf, otherIs, everyNth];
