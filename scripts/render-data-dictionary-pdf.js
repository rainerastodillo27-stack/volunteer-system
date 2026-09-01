const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const inputPath = path.resolve(process.argv[2] || 'docs/database-data-dictionary.html');
  const outputPath = path.resolve(process.argv[3] || 'docs/database-data-dictionary.pdf');
  const previewPath = outputPath.replace(/\.pdf$/i, '-preview.png');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${inputPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: previewPath, fullPage: false });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:7px;color:#66756c;text-align:center"><span>NVC Volunteer System — Live Data Dictionary</span> · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }
  console.log(`[OK] PDF: ${outputPath}`);
  console.log(`[OK] Preview: ${previewPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
