const fs = require("fs");
const { chromium } = require("playwright");
(async () => {
  const logo = fs.readFileSync("assets/nvc-logo.png").toString("base64");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.setContent("<canvas id='icon' width='256' height='256'></canvas>");
  const pngBase64 = await page.evaluate(async (logoBase64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${logoBase64}`;
    await image.decode();
    const canvas = document.getElementById("icon");
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 16, 0, 182, 140, 16, 42, 224, 172);
    return canvas.toDataURL("image/png").split(",")[1];
  }, logo);
  fs.writeFileSync("assets/nvc-browser-favicon.png", Buffer.from(pngBase64, "base64"));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });