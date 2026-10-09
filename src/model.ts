export type Lens = {
  id: string; name: string; kind: 'pcx' | 'custom' | 'fresnel' | 'macro'; enabled: boolean;
  diameter: number; clear: number; focal: number; thickness: number; edge: number;
  n: number; abbe: number; r1: number; r2: number; geometry: 'focal' | 'radii';
  flip: boolean; gap: number; transmission: number; coating: number;
  decenter: number; tilt: number; groove: number;
};
export type Config = {
  version: 1; name: string;
  objective: { focal: number; aperture: number; focus: number; subject: number; register: number; screenZ: number; exitPupilZ: number; exitPupilDiameter: number; transmission: number };
  screen: { mode: 'glass' | 'integrated' | 'none'; width: number; height: number; thickness: number; n: number; transmission: number; scatter: number; distribution: 'gaussian' | 'lambert'; grain: number };
  condensers: Lens[]; macros: Lens[];
  camera: { name: string; type: string; focal: number; sensorW: number; sensorH: number; pixelsW: number; pixelsH: number; aperture: number; focus: number; minFocus: number; gap: number; pupilOffset: number; targetM: number; transmission: number; exposure: number; iso: number; coc: number };
  settings: { wavelength: number; sceneLuminance: number; viewExposure: number; normalize: boolean; rays: number; tolerances: number; maxLength: number; minUniformity: number };
};
export function lens(preset: string, gap = 0): Lens {
  const base: Lens = { id: crypto.randomUUID(), name: preset, kind: 'pcx', enabled: true, diameter: 55.5, clear: 53.5, focal: 120, thickness: 8.5, edge: 1.7, n: 1.5168, abbe: 64.17, r1: 0, r2: 0, geometry: 'focal', flip: false, gap, transmission: 0.995, coating: 1, decenter: 0, tilt: 0, groove: 0.2 };
  if (preset === 'D52F80C9.2T2.4') Object.assign(base, { diameter: 52, clear: 50, focal: 80, thickness: 9.2, edge: 2.4 });
  if (preset.startsWith('Френель')) Object.assign(base, { kind: 'fresnel', focal: preset.includes('70') ? 70 : 50, diameter: 60, clear: 58, thickness: 1.5, edge: 1.5, n: 1.49, transmission: 0.90 });
  if (preset === 'Макро +10 D') Object.assign(base, { kind: 'macro', focal: 100, diameter: 52, clear: 49, thickness: 3, edge: 1.5 });
  return base;
}
export const presets = ['D55.5F120C8.5T1.7', 'D52F80C9.2T2.4', 'Френель f50', 'Френель f70', 'Макро +10 D'];
export function initial(): Config {
  return { version: 1, name: 'Гелиос / двойной конденсатор',
    objective: { focal: 58, aperture: 2.8, focus: 2000, subject: 2000, register: 45.46, screenZ: 45.46, exitPupilZ: -35, exitPupilDiameter: 20.7, transmission: 0.85 },
    screen: { mode: 'glass', width: 36, height: 24, thickness: 1.5, n: 1.5168, transmission: 0.7, scatter: 8, distribution: 'gaussian', grain: 12 },
    condensers: [lens('D55.5F120C8.5T1.7', 2), { ...lens('D55.5F120C8.5T1.7', 1), flip: true }], macros: [lens('Макро +10 D', 12)],
    camera: { name: 'Pixel 10 Pro · main (приближение)', type: 'phone', focal: 6.9, sensorW: 9.8, sensorH: 7.35, pixelsW: 4080, pixelsH: 3072, aperture: 1.68, focus: 180, minFocus: 100, gap: 75, pupilOffset: 0, targetM: 9.8 / 36, transmission: 0.85, exposure: 1 / 60, iso: 100, coc: 2 },
    settings: { wavelength: 550, sceneLuminance: 100, viewExposure: 0, normalize: true, rays: 32, tolerances: 0.5, maxLength: 220, minUniformity: 0.65 }
  };
}
// Import only fields belonging to the schema. Limits here protect the solver, not UI ranges.
export function validateConfig(value: unknown): Config {
  const template = initial();
  function check(v: unknown, t: unknown, path: string): void {
    if (Array.isArray(t)) {
      if (!Array.isArray(v) || v.length > 20) throw new Error(`${path}: ожидается массив до 20 элементов`);
      v.forEach((x, i) => check(x, lens('D55.5F120C8.5T1.7'), `${path}[${i}]`));
    } else if (t && typeof t === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path}: ожидается объект`);
      Object.entries(t).forEach(([k, x]) => check((v as Record<string, unknown>)[k], x, `${path}.${k}`));
    } else if (typeof v !== typeof t || (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 1e9))) throw new Error(`${path}: неверное значение`);
  }
  check(value, template, 'project');
  const c = structuredClone(value) as Config;
  if (c.version !== 1) throw new Error('Неподдерживаемая версия проекта');
  if (!['glass', 'integrated', 'none'].includes(c.screen.mode) || !['gaussian', 'lambert'].includes(c.screen.distribution)) throw new Error('Неизвестная модель экрана');
  const positive = [c.objective.focal, c.objective.aperture, c.objective.focus, c.objective.subject, c.objective.exitPupilDiameter, c.screen.width, c.screen.height, c.screen.n, c.camera.focal, c.camera.sensorW, c.camera.sensorH, c.camera.pixelsW, c.camera.pixelsH, c.camera.aperture, c.camera.targetM, c.settings.wavelength];
  if (positive.some(x => x <= 0) || c.camera.focus <= c.camera.focal || c.objective.focus <= c.objective.focal || c.objective.subject <= c.objective.focal) throw new Error('Недопустимые размеры или дистанция фокусировки');
  for (const l of [...c.condensers, ...c.macros]) {
    if (!['pcx', 'custom', 'fresnel', 'macro'].includes(l.kind) || !['focal', 'radii'].includes(l.geometry) || l.n <= 1 || l.diameter <= 0 || l.clear <= 0 || l.clear > l.diameter || l.thickness < 0 || l.gap < 0 || l.focal === 0) throw new Error(`Недопустимые параметры: ${l.name}`);
  }
  if ([c.camera.gap, c.screen.thickness, c.screen.scatter, c.settings.tolerances].some(x => x < 0)) throw new Error('Отрицательная толщина, зазор или рассеивание');
  for (const x of [c.screen.transmission, c.objective.transmission, c.camera.transmission, ...[...c.condensers, ...c.macros].flatMap(l => [l.transmission, l.coating])]) if (x < 0 || x > 1) throw new Error('Пропускание должно быть от 0 до 1');
  if (c.settings.rays < 8 || c.settings.rays > 256) throw new Error('Число лучей: 8–256');
  return c;
}
