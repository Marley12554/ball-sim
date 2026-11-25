import type { BlockSpec, CompiledNode, CompiledTrigger, ParamSpec } from '@engine/index';
import type { Sim, GroupInfo } from '../sim';
import type { SimEvent } from '../types';

export interface ObjectBlock extends BlockSpec {
  category: 'object';
  build?(sim: Sim, g: GroupInfo): void;
}
export interface TriggerBlock extends BlockSpec {
  category: 'trigger';
  setup(sim: Sim, t: CompiledTrigger): void;
}
export interface FilterBlock extends BlockSpec {
  category: 'filter';
  test(sim: Sim, n: CompiledNode, e: SimEvent): boolean;
}
export interface ActionBlock extends BlockSpec {
  category: 'action';
  run(sim: Sim, n: CompiledNode, e: SimEvent): void;
}
export type SimBlock = ObjectBlock | TriggerBlock | FilterBlock | ActionBlock;

export const BODY_PROPS = [
  { value: 'speed', label: 'Speed' },
  { value: 'size', label: 'Size' },
  { value: 'hp', label: 'HP' },
  { value: 'shield', label: 'Shield' },
  { value: 'tethers', label: 'Tethers' },
  { value: 'age', label: 'Age' },
  { value: 'dist', label: 'Distance from center' },
  { value: 'y', label: 'Height (Y)' },
  { value: 'stall', label: 'Time without progress' },
  { value: 'copy', label: 'Is a copy (0/1)' },
];

export const CMP: ParamSpec = {
  key: 'cmp', label: 'When', type: 'enum', default: 'below',
  options: [{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }],
};

export const cmpSym = (c: string) => (c === 'above' ? '>' : '<');
export const compare = (v: number, cmp: string, x: number) => (cmp === 'above' ? v > x : v < x);
