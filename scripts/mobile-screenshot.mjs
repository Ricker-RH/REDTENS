import { chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const preview = spawn('npm run preview -- --host 127.0.0.1 --port 4173', {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true
})

try {
  await wait(3000)
  const device = devices['iPhone 13 landscape']
  const browser = await chromium.launch()
  const context = await browser.newContext({
    ...device,
    viewport: device.viewport,
    screen: device.screen,
    isMobile: device.isMobile,
    deviceScaleFactor: device.deviceScaleFactor,
    hasTouch: device.hasTouch,
    userAgent: device.userAgent
  })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'mobile-home.png', fullPage: true })
  await page.goto('http://127.0.0.1:4173/table', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'mobile-table.png', fullPage: true })
  await browser.close()
} catch (err) {
  console.error(err)
} finally {
  preview.kill('SIGTERM')
}
