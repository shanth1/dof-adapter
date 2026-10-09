import { describe, it, expect } from 'vitest';
import { initial, lens, validateConfig } from './model';
import { mul, travel, power, lensMatrix, layout, refract, fresnel, trace, solve, optimize } from './optics';
describe('аналитическая оптика', () => {
  it('изображает объект 200 мм линзой f100 на 200 мм, m=-1', () => {
    const M=mul(travel(200),mul(power(1/100),travel(200)));
    expect(M[1]).toBeCloseTo(0,10);expect(M[0]).toBeCloseTo(-1,10);
  });
  it('толстая PCX сохраняет f120 независимо от ориентации и имеет det=1', () => {
    const l=lens('D55.5F120C8.5T1.7');
    for(const flip of [false,true]) {
      const M=lensMatrix({...l,flip});expect(-1/M[2]).toBeCloseTo(120,8);
      expect(M[0]*M[3]-M[1]*M[2]).toBeCloseTo(1,12);
    }
  });
  it('две разделённые тонкие линзы имеют P=P1+P2-dP1P2', () => {
    const M=mul(power(.01),mul(travel(10),power(.02)));expect(-M[2]).toBeCloseTo(.028,12);
  });
  it('толстая симметричная макролинза воспроизводит заданные диоптрии обоих знаков', () => {
    for(const focal of [100,-100,50]) {const l={...lens('Макро +10 D'),focal};expect(-1/lensMatrix(l)[2]).toBeCloseTo(focal,9);}
  });
  it('закон Снеллиуса и полное внутреннее отражение', () => {
    const r=refract([.5,0,Math.sqrt(.75)],[0,0,-1],1,1.5)!;
    expect(r[0]).toBeCloseTo(1/3,12);
    expect(refract([Math.sqrt(.75),0,.5],[0,0,-1],1.5,1)).toBeNull();
    expect(fresnel(1,1,1.5)).toBeCloseTo(.04,12);
  });
  it('точные сферические лучи сходятся к параксиальной матрице', () => {
    const c=initial();c.screen.mode='integrated';c.condensers=[lens('D55.5F120C8.5T1.7')];c.macros=[];c.camera.gap=100;
    const L=layout(c),r=trace(c,L,.001,0,.00001,0);
    expect(r.blocked).toBe(false);
    expect(r.p[0]).toBeCloseTo(L.matrix[0]*.001+L.matrix[1]*.00001,7);
  });
  it('камера без дополнительных линз даёт известные фокус, охват и нулевой геометрический дефокус', () => {
    const c=initial();c.screen.thickness=0;c.condensers=[];c.macros=[];c.camera.gap=200;c.camera.focus=200;
    const r=solve(c,false);
    expect(r.requiredFocus).toBeCloseTo(200,10);expect(r.focusBlur).toBeCloseTo(0,10);
    expect(Math.abs(r.magnification)).toBeCloseTo(c.camera.focal/(200-c.camera.focal),10);
  });
  it('нет искусственного усиления потока; решение детерминировано', () => {
    const c=initial(),a=solve(c,false),b=solve(c,false);
    expect(a.grid).toEqual(b.grid);expect(a.collection).toBeGreaterThanOrEqual(0);expect(a.collection).toBeLessThanOrEqual(1);
    expect(a.transmission).toBeLessThanOrEqual(1);expect(a.grid.every(Number.isFinite)).toBe(true);
  });
  it('сбор света ламбертова экрана согласуется с аналитическим интегралом круглого зрачка', () => {
    const c=initial();c.screen.n=1;c.screen.thickness=0;c.screen.distribution='lambert';c.condensers=[];c.macros=[];
    c.camera.focal=10;c.camera.aperture=1;c.camera.gap=20;c.camera.focus=20;c.settings.rays=64;
    const r=solve(c);const R=c.camera.focal/(2*c.camera.aperture);
    expect(r.collection).toBeCloseTo(R*R/(20*20+R*R),7);
  });
  it('закрытие диафрагмы увеличивает дифракционное размытие', () => {
    const c=initial(),a=solve(c,false);c.objective.aperture=16;const b=solve(c,false);
    expect(b.diffraction).toBeGreaterThan(a.diffraction);
  });
  it('интегрированный экран требует реально плоского входа', () => {
    const c=initial();c.screen.mode='integrated';c.condensers[0].flip=true;
    expect(solve(c,false).valid).toBe(false);
    c.condensers[0].flip=false;c.condensers[0].tilt=5;expect(solve(c,false).valid).toBe(false);
  });
  it('закрытие диафрагмы объектива снижает освещённость для ламбертова экрана', () => {
    const c=initial();c.screen.distribution='lambert';const a=solve(c,false);c.objective.aperture*=2;const b=solve(c,false);
    expect(b.centerLux/a.centerLux).toBeCloseTo(.25,8);
    expect(b.evLoss-a.evLoss).toBeCloseTo(2,8);
  });
  it('подбор выдаёт только достижимый фокус и ограниченную длину', () => {
    const c=initial();for(const r of optimize(c)) { expect(r.focus).toBeGreaterThanOrEqual(c.camera.minFocus);expect(r.length).toBeLessThanOrEqual(c.settings.maxLength); }
  });
  it('импорт отвергает неполный проект и физически невозможные входные данные', () => {
    expect(()=>validateConfig({})).toThrow();const c=initial();expect(validateConfig(c).version).toBe(1);
    c.condensers[0].clear=1000;expect(()=>validateConfig(c)).toThrow();
  });
});
