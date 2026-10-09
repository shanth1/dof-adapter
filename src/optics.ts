import type { Config, Lens } from './model';
export type Mat = [number, number, number, number];
export const identity: Mat = [1, 0, 0, 1];
export const mul = (a: Mat, b: Mat): Mat => [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3]];
export const travel = (d: number, n = 1): Mat => [1, d/n, 0, 1];
export const power = (p: number): Mat => [1, 0, -p, 1];
export function radii(l: Lens): [number, number] {
  // A PCX focal length determines curvature only after assuming refractive index.
  const symmetricR=(l.n-1)*(l.focal+Math.sign(l.focal)*Math.sqrt(Math.max(0,l.focal*l.focal-l.focal*l.thickness/l.n)));
  let rs: [number, number] = l.geometry === 'radii' ? [l.r1, l.r2] : l.kind === 'macro' ? [symmetricR,-symmetricR] : [0, -(l.n-1)*l.focal];
  if (l.flip) rs = [-rs[1], -rs[0]];
  return rs;
}
export function lensMatrix(l: Lens): Mat {
  if (l.kind === 'fresnel') return mul(travel(l.thickness), power(1/l.focal));
  const [r1, r2] = radii(l);
  return mul(power(r2 ? (1-l.n)/r2 : 0), mul(travel(l.thickness, l.n), power(r1 ? (l.n-1)/r1 : 0)));
}
export type Positioned = { lens: Lens; z: number; matrix: Mat };
export type Layout = { elements: Positioned[]; matrix: Mat; end: number; pupilZ: number; screenExit: number; warnings: string[] };
export function layout(c: Config): Layout {
  let z = c.screen.mode === 'glass' ? c.screen.thickness : 0;
  let matrix = c.screen.mode === 'glass' ? travel(c.screen.thickness, c.screen.n) : identity;
  const screenExit = z;
  const elements: Positioned[] = []; const warnings: string[] = [];
  const active = [...c.condensers, ...c.macros].filter(l => l.enabled);
  if (c.screen.mode === 'integrated' && (!c.condensers.some(l => l.enabled) || !active[0] || radii(active[0])[0] !== 0 || active[0].tilt !== 0 || active[0].kind === 'fresnel')) warnings.push('Для матирования нужна плоская входная поверхность первого стеклянного конденсатора в плоскости экрана. Текущая конфигурация несовместима.');
  active.forEach((l, i) => {
    const gap = c.screen.mode === 'integrated' && i === 0 ? 0 : l.gap;
    z += gap; matrix = mul(travel(gap), matrix);
    elements.push({ lens: l, z, matrix });
    matrix = mul(lensMatrix(l), matrix); z += l.thickness;
    const [r1,r2] = radii(l);
    if(l.geometry==='focal'&&l.kind==='macro'&&l.focal>0&&l.focal<l.thickness/l.n)warnings.push(`${l.name}: заданная симметричная толстая линза невозможна при этих f, t и n.`);
    if (l.kind !== 'fresnel' && [r1,r2].some(r => r !== 0 && Math.abs(r) < l.diameter/2)) warnings.push(`${l.name}: радиус меньше половины диаметра; сферическая поверхность невозможна.`);
    if (l.decenter || l.tilt) warnings.push(`${l.name}: децентровка/наклон учитываются трассировкой; параксиальный фокус и охват относятся к центрированной системе.`);
    if (l.geometry === 'focal' && l.kind === 'pcx') {
      const r = Math.abs((l.n-1)*l.focal); const a = l.diameter/2;
      if (r >= a) {
        const edge = l.thickness - Math.sign(l.focal)*(r-Math.sqrt(r*r-a*a));
        if (Math.abs(edge-l.edge) > 0.5) warnings.push(`${l.name}: заданные f, n и толщины не согласованы со сферой (расчётный край ${edge.toFixed(2)} мм, задан ${l.edge} мм). Проверьте материал/паспорт.`);
      }
    }
  });
  const end = z; const pupilZ = z+c.camera.gap+c.camera.pupilOffset;
  if (c.camera.gap+c.camera.pupilOffset < 0) warnings.push('Входной зрачок камеры пересекает последний элемент.');
  matrix = mul(travel(pupilZ-z), matrix);
  return { elements, matrix, end, pupilZ, screenExit, warnings };
}
type Vec = [number, number, number];
const dot = (a: Vec,b: Vec) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm = (a: Vec): Vec => {const s=Math.hypot(...a);return a.map(x=>x/s) as Vec;};
export type Ray = { p: Vec; d: Vec; weight: number; points: Vec[]; blocked: boolean };
export function refract(direction: Vec, normal: Vec, n1: number, n2: number): Vec | null {
  let nn = normal; if (dot(direction,nn)>0) nn=nn.map(x=>-x) as Vec;
  const cos = -dot(direction,nn), eta=n1/n2, k=1-eta*eta*(1-cos*cos);
  if(k<0) return null;
  return norm(direction.map((x,i)=>eta*x+(eta*cos-Math.sqrt(k))*nn[i]) as Vec);
}
export function fresnel(cos: number, n1: number, n2: number): number {
  const sin2=(n1/n2)**2*(1-cos*cos); if(sin2>=1)return 1;
  const ct=Math.sqrt(1-sin2);
  return (((n1*cos-n2*ct)/(n1*cos+n2*ct))**2+((n1*ct-n2*cos)/(n1*ct+n2*cos))**2)/2;
}
function plane(ray: Ray, z: number): Vec {
  const t=(z-ray.p[2])/ray.d[2];return [ray.p[0]+t*ray.d[0],ray.p[1]+t*ray.d[1],z];
}
function surface(ray: Ray,z: number,r: number,n1: number,n2: number,clear: number,dx: number,coating: number): boolean {
  let hit: Vec; let normal: Vec;
  if (!r) {hit=plane(ray,z);normal=[0,0,-1];}
  else {
    const center: Vec=[dx,0,z+r]; const q=ray.p.map((x,i)=>x-center[i]) as Vec;
    const b=dot(q,ray.d), disc=b*b-dot(q,q)+r*r;
    if(disc<0){ray.blocked=true;return false;}
    const ts=[-b-Math.sqrt(disc),-b+Math.sqrt(disc)];
    // Choose the vertex hemisphere, including t≈0 for integrated screens.
    const hits=ts.filter(t=>t>=-1e-7).map(t=>ray.p.map((x,i)=>x+t*ray.d[i]) as Vec).filter(p=>(p[2]-center[2])*r<=1e-7);
    if(!hits.length){ray.blocked=true;return false;}
    hit=hits[0];normal=norm(hit.map((x,i)=>x-center[i]) as Vec);
  }
  ray.points.push(hit);
  if(Math.hypot(hit[0]-dx,hit[1])>clear/2){ray.blocked=true;ray.p=hit;return false;}
  const cos=Math.abs(dot(ray.d,normal)); const d=refract(ray.d,normal,n1,n2);
  if(!d||d[2]<=0){ray.blocked=true;return false;}
  ray.weight*=1-fresnel(cos,n1,n2)*coating;ray.p=hit;ray.d=d;return true;
}
export function trace(c: Config,L: Layout,x: number,y: number,tx: number,ty: number): Ray {
  const ray: Ray={p:[x,y,0],d:norm([tx,ty,1]),weight:1,points:[[x,y,0]],blocked:false};
  if(c.screen.mode==='glass') {
    if(!surface(ray,0,0,1,c.screen.n,1e9,0,1)||!surface(ray,c.screen.thickness,0,c.screen.n,1,1e9,0,1))return ray;
  }
  for(const {lens:l,z} of L.elements) {
    if(l.kind==='fresnel') {
      const p=plane(ray,z);ray.points.push(p);ray.p=p;
      if(Math.hypot(p[0]-l.decenter,p[1])>l.clear/2){ray.blocked=true;return ray;}
      ray.d=norm([ray.d[0]/ray.d[2]-(p[0]-l.decenter)/l.focal,ray.d[1]/ray.d[2]-p[1]/l.focal,1]);
      ray.p=plane(ray,z+l.thickness);ray.points.push(ray.p);
      ray.weight*=(1-fresnel(1,1,l.n)*l.coating)**2*l.transmission;
    } else {
      const [r1,r2]=radii(l);const angle=l.tilt*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle),start=ray.points.length;
      const toLocal=(p:Vec,point=true):Vec=>{const x=p[0]-(point?l.decenter:0),zz=p[2]-(point?z:0);return [cs*x-sn*zz,p[1],sn*x+cs*zz];};
      const toWorld=(p:Vec,point=true):Vec=>[cs*p[0]+sn*p[2]+(point?l.decenter:0),p[1],-sn*p[0]+cs*p[2]+(point?z:0)];
      ray.p=toLocal(ray.p);ray.d=toLocal(ray.d,false);
      const passed=surface(ray,0,r1,1,l.n,l.clear,0,l.coating)&&surface(ray,l.thickness,r2,l.n,1,l.clear,0,l.coating);
      ray.p=toWorld(ray.p);ray.d=toWorld(ray.d,false);
      for(let i=start;i<ray.points.length;i++)ray.points[i]=toWorld(ray.points[i]);
      if(!passed)return ray;
      ray.weight*=l.transmission;
    }
  }
  ray.p=plane(ray,L.pupilZ);ray.points.push(ray.p);return ray;
}
export type Result = {
  layout: Layout; matrix: Mat; efl: number | null; magnification: number; imageW: number; imageH: number;
  sensorDistance: number; requiredFocus: number | null; focusBlur: number; objectiveBlur: number; diffraction: number;
  totalBlur: number; transmission: number; collection: number; centerLux: number; evLoss: number;
  uniformity: number; distortion: number; coverage: number; grid: number[]; blurGrid: number[]; distortionGrid: number[]; aberrationBlur: number; worstBlur: number; nx: number; ny: number;
  rays: Ray[]; warnings: string[]; valid: boolean; integrated: boolean;
};
export function solve(c: Config, detailed=true): Result {
  const L=layout(c), [A,B,C,D]=L.matrix;
  const f=c.camera.focal, focus=c.camera.focus, v=f*focus/(focus-f), sensor=mul(travel(v),mul(power(1/f),L.matrix));
  const requiredFocus=Math.abs(D)>1e-10 ? B/D : null;
  const magnification=Math.abs(B)>1e-9 ? -v/B : 0;
  const pupil=f/c.camera.aperture;
  const focusBlur=Math.abs(B)>1e-9?Math.abs(sensor[1]/B)*pupil:1e6;
  // Helicoid aligns chosen focus distance to nominal screen plane; image shift uses thin-lens conjugates.
  const obj=c.objective, focused=obj.focal*obj.focus/(obj.focus-obj.focal), actual=obj.focal*obj.subject/(obj.subject-obj.focal);
  const delta=(c.objective.screenZ-c.objective.register)-(actual-focused);
  const objectiveBlur=Math.abs(delta)*obj.focal/obj.aperture/actual;
  const diffraction=2.44*c.settings.wavelength*1e-6*Math.hypot(c.camera.aperture*v/f,obj.aperture*actual/obj.focal*Math.abs(magnification));
  const staticBlur=Math.hypot(objectiveBlur*Math.abs(magnification),diffraction,c.screen.mode==='none'?0:c.screen.grain/1000*Math.abs(magnification));
  const warnings=[...L.warnings];
  if(c.screen.mode==='none')warnings.push('Без рассеивающей поверхности это aerial-image схема: hotspot и поток модели матового экрана неприменимы. Здесь показана только геометрия и фокус.');
  if(requiredFocus===null||requiredFocus<=f)warnings.push('Камере требуется виртуальный объект или недостижимое положение фокуса.');
  else if(requiredFocus<c.camera.minFocus)warnings.push(`Нужная дистанция фокуса ${requiredFocus.toFixed(1)} мм меньше минимальной ${c.camera.minFocus} мм.`);
  if(focus<c.camera.minFocus)warnings.push('Заданная фокусировка камеры находится за пределом её минимальной дистанции.');
  if(c.camera.type==='phone')warnings.push('Профиль телефона — эквивалентная тонкая линза. EFL, активный сенсор, зрачок и МДФ требуют проверки для выбранного модуля и режима съёмки.');
  if(L.elements.some(e=>e.lens.kind==='fresnel'))warnings.push('Френель моделируется идеальной тонкой линзой: канавки, паразитные порядки и их рассеивание не рассчитаны.');
  warnings.push('Материал BK7/PMMA, покрытия и угловое рассеивание — допущения, пока не введены паспортные или измеренные данные.');
  const imageW=Math.abs(magnification)*c.screen.width,imageH=Math.abs(magnification)*c.screen.height;
  const coverage=Math.min(1,c.camera.sensorW/(imageW||1e9))*Math.min(1,c.camera.sensorH/(imageH||1e9));
  const nx=detailed?19:5,ny=detailed?13:3;
  const grid:number[]=[], blurGrid:number[]=[], distortionGrid:number[]=[], rays:Ray[]=[]; let centerCollection=0, transmission=0,maxDist=0,aberrationBlur=0;
  const N=detailed?Math.round(c.settings.rays):12;
  const rawExitDistance=c.objective.screenZ-c.objective.exitPupilZ;
  const exitDistance=Math.abs(rawExitDistance)<1e-6?1e-6:rawExitDistance;
  if(Math.abs(rawExitDistance)<1)warnings.push('Выходной зрачок находится вблизи экрана: угловая модель объектива недостоверна.');
  const exitRadius=c.objective.exitPupilDiameter/2;
  const scatter=c.screen.scatter*Math.PI/180;
  // Moment-matched Gaussian for a uniform exit-pupil disk convolved with measured screen scatter.
  const sigma=Math.max(0.0005,Math.hypot(scatter,exitRadius/(2*exitDistance)));
  for(let iy=0;iy<ny;iy++)for(let ix=0;ix<nx;ix++) {
    const x=(ix/(nx-1)-.5)*c.screen.width,y=(iy/(ny-1)-.5)*c.screen.height;
    let sum=0,weightSum=0,sumX=0,sumY=0,sumXX=0,sumYY=0,bestX=0,bestY=0,bestXX=0,bestYY=0,deltaX=0,deltaY=0;
    for(let k=0;k<N;k++) {
      const r=pupil/2*Math.sqrt((k+.5)/N),phi=k*2.399963229728653;
      const px=r*Math.cos(phi),py=r*Math.sin(phi);
      let tx=(px-A*x)/B,ty=(py-A*y)/B;
      if(!Number.isFinite(tx)||!Number.isFinite(ty)||Math.abs(tx)>10||Math.abs(ty)>10)continue;
      let ray=trace(c,L,x,y,tx,ty);
      // Newton shooting to reach sampled entrance pupil through actual curved surfaces.
      for(let it=0;it<5&&!ray.blocked;it++) {
        const ex=px-ray.p[0],ey=py-ray.p[1]; if(Math.hypot(ex,ey)<.005)break;
        const eps=1e-5,rx=trace(c,L,x,y,tx+eps,ty),ry=trace(c,L,x,y,tx,ty+eps);
        if(rx.blocked||ry.blocked)break;
        const j00=(rx.p[0]-ray.p[0])/eps,j10=(rx.p[1]-ray.p[1])/eps,j01=(ry.p[0]-ray.p[0])/eps,j11=(ry.p[1]-ray.p[1])/eps,det=j00*j11-j01*j10;
        if(Math.abs(det)<1e-8)break;
        tx+=(ex*j11-ey*j01)/det;ty+=(ey*j00-ex*j10)/det;ray=trace(c,L,x,y,tx,ty);
      }
      if(detailed && iy===Math.floor(ny/2) && [0,Math.floor(nx/2),nx-1].includes(ix)&&k<5)rays.push(ray);
      if(ray.blocked||Math.hypot(ray.p[0]-px,ray.p[1]-py)>.1)continue;
      const cosine=1/Math.sqrt(1+tx*tx+ty*ty);
      const pdf=c.screen.distribution==='lambert'?cosine/Math.PI:Math.exp(-((tx-x/exitDistance)**2+(ty-y/exitDistance)**2)/(2*sigma*sigma))/(2*Math.PI*sigma*sigma);
      const eps=1e-5,dx=trace(c,L,x,y,tx+eps,ty),dy=trace(c,L,x,y,tx,ty+eps);
      const jacobian=dx.blocked||dy.blocked?B*B:Math.abs(((dx.p[0]-ray.p[0])*(dy.p[1]-ray.p[1])-(dy.p[0]-ray.p[0])*(dx.p[1]-ray.p[1]))/(eps*eps));
      const solid=Math.PI*(pupil/2)**2/Math.max(1e-8,jacobian)*cosine**3;
      const weight=pdf*solid*ray.weight;sum+=weight;weightSum+=weight;
      const sx=ray.p[0]+v*(ray.d[0]/ray.d[2]-ray.p[0]/f),sy=ray.p[1]+v*(ray.d[1]/ray.d[2]-ray.p[1]/f);
      sumX+=sx*weight;sumY+=sy*weight;sumXX+=sx*sx*weight;sumYY+=sy*sy*weight;
      const idealV=requiredFocus!==null&&requiredFocus>f?f*requiredFocus/(requiredFocus-f):v;
      const bx=ray.p[0]+idealV*(ray.d[0]/ray.d[2]-ray.p[0]/f),by=ray.p[1]+idealV*(ray.d[1]/ray.d[2]-ray.p[1]/f);
      bestX+=bx*weight;bestY+=by*weight;bestXX+=bx*bx*weight;bestYY+=by*by*weight;
      deltaX+=(sx-(sensor[0]*x+sensor[1]*tx))*weight;deltaY+=(sy-(sensor[0]*y+sensor[1]*ty))*weight;
      if(ix===Math.floor(nx/2)&&iy===Math.floor(ny/2))transmission+=ray.weight/N;
    }
    const collection=Math.min(1,Math.max(0,sum/N));
    if(ix===Math.floor(nx/2)&&iy===Math.floor(ny/2))centerCollection=collection;
    const cos4=(1+(x*x+y*y)/(obj.focal*obj.focal))**-2;
    grid.push(collection*cos4);
    const spot=weightSum>0?2*Math.sqrt(Math.max(0,(sumXX+sumYY)/weightSum-(sumX/weightSum)**2-(sumY/weightSum)**2)):focusBlur;
    const aberration=weightSum>0?2*Math.sqrt(Math.max(0,(bestXX+bestYY)/weightSum-(bestX/weightSum)**2-(bestY/weightSum)**2)):0;
    const distortion=weightSum>0?Math.hypot(deltaX/weightSum,deltaY/weightSum)/Math.max(.001,Math.abs(magnification)*Math.hypot(x,y)):0;
    blurGrid.push(Math.hypot(spot,staticBlur));distortionGrid.push(distortion);
    if(Math.hypot(x,y)>c.screen.width*.3)maxDist=Math.max(maxDist,distortion);
    if(ix===Math.floor(nx/2)&&iy===Math.floor(ny/2))aberrationBlur=aberration;
  }
  const max=Math.max(...grid),min=Math.min(...grid); const uniformity=max>0?min/max:0;
  const screenT=c.screen.mode==='none'?1:c.screen.transmission;
  const centerLux=c.settings.sceneLuminance*Math.PI/(4*obj.aperture**2)*obj.transmission*screenT*centerCollection*c.camera.transmission/(magnification*magnification||1);
  const relative=(2/obj.aperture)**2*obj.transmission*screenT*centerCollection*c.camera.transmission;
  const valid=Number.isFinite(B)&&Math.abs(B)>1e-6&&!L.warnings.some(w=>w.includes('невозможна')||w.includes('несовместима'))&&c.screen.mode!=='none';
  const totalBlur=blurGrid[Math.floor(ny/2)*nx+Math.floor(nx/2)];
  return {layout:L,matrix:sensor,efl:Math.abs(C)>1e-10?-1/C:null,magnification,imageW,imageH,sensorDistance:v,requiredFocus,focusBlur,objectiveBlur,diffraction,totalBlur,aberrationBlur,worstBlur:Math.max(...blurGrid),transmission,collection:centerCollection,centerLux,evLoss:relative>0?-Math.log2(relative):Infinity,uniformity,distortion:maxDist,coverage,grid,blurGrid,distortionGrid,nx,ny,rays,warnings,valid,integrated:c.screen.mode==='integrated'};
}
export type Candidate = { gap:number; focus:number; uniformity:number; blur:number; coverage:number; collection:number; length:number; score:number };
export function optimize(c: Config): Candidate[] {
  const candidates:Candidate[]=[];
  for(let gap=5;gap<=c.settings.maxLength;gap+=Math.max(3,c.settings.maxLength/300)) {
    const test=structuredClone(c);test.camera.gap=gap;
    const L=layout(test),focus=L.matrix[1]/L.matrix[3];
    if(!Number.isFinite(focus)||focus<Math.max(c.camera.minFocus,c.camera.focal+1)||L.pupilZ>c.settings.maxLength)continue;
    test.camera.focus=focus;const r=solve(test,false);
    if(!r.valid)continue;
    const error=Math.abs(Math.abs(r.magnification)-c.camera.targetM)/c.camera.targetM;
    const score=r.uniformity*3+r.coverage+Math.log10(Math.max(1e-9,r.collection))*.15-error*2-r.layout.pupilZ/2000;
    candidates.push({gap,focus,uniformity:r.uniformity,blur:r.totalBlur,coverage:r.coverage,collection:r.collection,length:L.pupilZ,score});
  }
  return candidates.sort((a,b)=>b.score-a.score).filter((x,i,all)=>i===0||Math.abs(x.gap-all[0].gap)>5).slice(0,5);
}
export type SweepRequest = { target: 'cameraGap' | 'scatter' | 'aperture' | 'condenserFocal' | 'condenserGap' | 'macroPower'; min: number; max: number; steps: number };
export type SweepRow = { value: number; uniformity: number; coverage: number; blur: number; collection: number; focus: number | null; reachable: boolean };
export function sweep(c:Config,request:SweepRequest): SweepRow[] {
  const rows:SweepRow[]=[];const steps=Math.min(60,Math.max(2,Math.round(request.steps)));
  for(let i=0;i<steps;i++) {
    const value=request.min+(request.max-request.min)*i/(steps-1),test=structuredClone(c);
    if(request.target==='cameraGap')test.camera.gap=value;
    if(request.target==='scatter')test.screen.scatter=value;
    if(request.target==='aperture')test.objective.aperture=value;
    if(request.target==='condenserFocal'&&test.condensers[0])Object.assign(test.condensers[0],{focal:value,geometry:'focal'});
    if(request.target==='condenserGap'&&test.condensers[0])test.condensers[0].gap=value;
    if(request.target==='macroPower'&&test.macros[0])Object.assign(test.macros[0],{focal:1000/(value||1e-6),geometry:'focal'});
    if(value<0&&['cameraGap','scatter','condenserGap'].includes(request.target))continue;
    if(value<=0&&['aperture','condenserFocal'].includes(request.target))continue;
    const L=layout(test),focus=L.matrix[1]/L.matrix[3];
    const reachable=Number.isFinite(focus)&&focus>=Math.max(test.camera.minFocus,test.camera.focal+1);
    if(reachable)test.camera.focus=focus;
    const r=solve(test,false);rows.push({value,uniformity:r.uniformity,coverage:r.coverage,blur:r.totalBlur,collection:r.collection,focus:r.requiredFocus,reachable:reachable&&r.valid});
  }
  return rows;
}
