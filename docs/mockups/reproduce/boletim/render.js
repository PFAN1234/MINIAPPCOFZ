const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const dir = __dirname;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(dir, 'boletim.html'));
  await page.pdf({
    path: path.join(dir, 'boletim.pdf'),
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-family:Liberation Serif,serif;font-size:8px;color:#444;padding:0 12mm;display:flex;justify-content:space-between">' +
      '<span>BA2/261111/COFZ · Boletim de Acompanhamento Diário</span>' +
      '<span>Prévia: registros, fotos, indicadores e INMET ilustrativos; clima Open-Meteo real de 11/11/2026</span>' +
      '<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
    margin: { top: '12mm', bottom: '16mm', left: '12mm', right: '12mm' },
    preferCSSPageSize: true,
  });
  await browser.close();
})();
