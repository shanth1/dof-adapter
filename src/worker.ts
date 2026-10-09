import { solve, optimize, sweep, type SweepRequest } from './optics';
import type { Config } from './model';
self.onmessage = (event: MessageEvent<{ id: number; config: Config; action: 'solve' | 'optimize' | 'sweep'; request?: SweepRequest }>) => {
  const { id, config, action, request } = event.data;
  try { self.postMessage({ id, action, result: action === 'solve' ? solve(config) : action === 'sweep' ? sweep(config, request!) : optimize(config) }); }
  catch (e) { self.postMessage({ id, action, error: e instanceof Error ? e.message : String(e) }); }
};
