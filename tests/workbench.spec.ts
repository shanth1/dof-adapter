import { test, expect } from '@playwright/test';
test('редактор, карты и локальное сохранение', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  await expect(page.locator('.metric')).toHaveCount(4);await expect(page.locator('.scheme svg polyline')).not.toHaveCount(0);
  const aperture=page.getByRole('textbox',{name:'Диафрагма',exact:true});await aperture.fill('5,6');await aperture.press('Enter');
  await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dof-project-v1')!).objective.aperture);expect(saved).toBe(5.6);
  await page.locator('.preview').getByRole('button',{name:'Hotspot',exact:true}).click();await expect(page.getByRole('heading',{name:'Карта освещённости'})).toBeVisible();
  const colors=await page.locator('canvas').evaluate((el:HTMLCanvasElement)=>{const ctx=el.getContext('2d')!;return [Array.from(ctx.getImageData(el.width/2,el.height/2,1,1).data),Array.from(ctx.getImageData(0,0,1,1).data)];});expect(colors[0]).not.toEqual(colors[1]);
  await page.locator('.preview').getByRole('button',{name:'Фокус',exact:true}).click();await expect(page.getByRole('heading',{name:'Размытие по полю'})).toBeVisible();
  await page.locator('.preview').getByRole('button',{name:'Аберрации',exact:true}).click();await expect(page.getByRole('heading',{name:'Зоны нелинейности'})).toBeVisible();
  await page.reload();await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');await expect(aperture).toHaveValue('5.6');
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});expect(errors).toEqual([]);
});
test('подбор, исследование и отчёт', async ({ page }) => {
  await page.goto('/');await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  await page.getByRole('button',{name:'Подбор и отчёт',exact:true}).click();
  await page.getByRole('button',{name:'Найти расположение →'}).click();
  await expect(page.getByRole('button',{name:'Найти расположение →'})).toBeEnabled();
  await expect(page.locator('.optimizer table tbody tr')).not.toHaveCount(0);
  await page.locator('.optimizer').getByRole('button',{name:'Применить',exact:true}).first().click();await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  await page.getByRole('button',{name:'Исследовать диапазон',exact:true}).click();await expect(page.locator('.sweep-table tbody tr')).toHaveCount(26);
  await page.getByRole('button',{name:'＋ Снимок параметров'}).click();await expect(page.getByRole('button',{name:'Открыть',exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'↧ Отчёт JSON'}).click();const download=await downloadEvent;expect(download.suggestedFilename()).toBe('dof-report.json');
  await page.getByRole('button',{name:'Модель и точность'}).click();await expect(page.getByRole('heading',{name:'Границы точности'})).toBeVisible();
});
test('матирование входа, произвольные линзы и импорт', async ({ page }) => {
  await page.goto('/');await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  await page.locator('.editor-panel').filter({hasText:'Матовая поверхность'}).locator('summary').first().click();
  await page.getByLabel('Конструкция экрана').selectOption('integrated');await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  await page.locator('.add-lens').first().selectOption('D52F80C9.2T2.4');await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  await expect(page.locator('.assumptions')).toContainText('не согласованы');
  const data=await page.evaluate(()=>localStorage.getItem('dof-project-v1')!);
  await page.locator('input[type=file]').first().setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(data)});
  await expect(page.getByRole('status')).toHaveText('Проект импортирован');
  await page.locator('input[type=file]').first().setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"version":1}')});
  await expect(page.getByRole('status')).toContainText('Ошибка импорта');
});
test('мобильный интерфейс без внешних запросов', async ({ page }) => {
  const external:string[]=[];page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:5177')&&!req.url().startsWith('data:'))external.push(req.url());});
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.compute-status')).toContainText('Расчёт обновлён');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});expect(external).toEqual([]);
});
