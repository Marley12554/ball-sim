import { Registry } from '@engine/index';
import type { SimBlock } from './types';
import { OBJECT_BLOCKS } from './objects';
import { TRIGGER_BLOCKS } from './triggers';
import { FILTER_BLOCKS } from './filters';
import { ACTION_BLOCKS } from './actions';

/** Every block the editor and runtime know about. To add a block, define it in a category file and list it there. */
export const registry = new Registry<SimBlock>();
for (const b of [...OBJECT_BLOCKS, ...TRIGGER_BLOCKS, ...FILTER_BLOCKS, ...ACTION_BLOCKS]) registry.add(b);

export type { SimBlock };
