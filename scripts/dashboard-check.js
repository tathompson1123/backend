/**
 * SORCE Dashboard Full Check — Playwright
 * Creates a fresh test account and walks through every feature/button.
 *
 * Usage:
 *   node scripts/dashboard-check.js
 *
 * Requires: npx playwright install chromium (first time only)
 */

const { chromium } = require('playwright');

const FRONTEND_URL = 'http://localhost:5173';
const TS = Date.now();
const TEST_EMAIL = `test+${TS}@sorce-check.dev`;
const TEST_PASSWORD = 'TestPass123!';
const TEST_NAME = 'Test User';
const TEST_BIZ = 'Sorce Test Business';

const results = [];
let screenshotIndex = 0;
let currentSection = 'init';

function log(icon, label, detail = '') {
  const line = `${icon} ${label}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ icon, label, detail });
}

async function shot(page, label) {
  const name = `shot-${String(++screenshotIndex).padStart(3, '0')}-${label.replace(/\s+/g, '-').toLowerCase()}.png`;
  await page.screenshot({ path: `scripts/screenshots/${name}`, fullPage: false });
  return name;
}

async function waitForNoSpinner(page, timeout = 8000) {
  // Wait for loading spinners / skeletons to disappear
  try {
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('[class*="animate-spin"], [class*="animate-pulse"]');
      return spinners.length === 0;
    }, { timeout });
  } catch {
    // ok if it times out — page may not have spinners
  }
}

async function checkForErrors(page, section) {
  const text = await page.textContent('body');
  const errorPatterns = [
    /something went wrong/i,
    /cannot read prop/i,
    /typeerror/i,
    /referenceerror/i,
    /undefined is not/i,
    /failed to fetch/i,
    /network error/i,
    /500 internal/i,
  ];
  for (const p of errorPatterns) {
    if (p.test(text)) {
      log('❌', `${section} — error text found`, text.match(p)?.[0]);
      return false;
    }
  }
  return true;
}

async function clickIfExists(page, selector, label) {
  try {
    const el = await page.$(selector);
    if (el && await el.isVisible()) {
      await el.click();
      await page.waitForTimeout(600);
      log('🖱️', `Clicked: ${label}`);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function navTo(page, viewId, label) {
  try {
    await page.evaluate((id) => {
      window.dispatchEvent(new CustomEvent('navigate-to-view', { detail: { view: id } }));
    }, viewId);
    await page.waitForTimeout(900);
    await waitForNoSpinner(page);
  } catch (e) {
    log('⚠️', `navTo failed for ${label}`, e.message);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  // Create screenshots dir
  const fs = require('fs');
  if (!fs.existsSync('scripts/screenshots')) fs.mkdirSync('scripts/screenshots', { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture console errors and 404s
  const consoleErrors = [];
  const notFoundUrls = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));
  const failedRequests = [];
  page.on('response', res => {
    const status = res.status();
    if (status >= 400) failedRequests.push({ status, url: res.url(), section: currentSection });
  });

  try {
    // ── 1. SIGNUP ─────────────────────────────────────────────────────────────
    log('🚀', 'Navigating to homepage');
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
    await shot(page, 'homepage');

    log('📝', 'Opening signup modal');
    // Click "Sign Up" button (in header nav or footer — NOT "Get Started" which opens website generator)
    const signupBtn = await page.$('button:has-text("Sign Up")');
    if (!signupBtn) throw new Error('Could not find Sign Up button on homepage');
    await signupBtn.click();
    await page.waitForTimeout(800);

    // Wait for the auth modal to appear (has Full Name field)
    await page.waitForSelector('[placeholder="Full Name"]', { timeout: 5000 });

    await page.fill('[placeholder="Full Name"]', TEST_NAME);
    await page.fill('[placeholder="Business Name"]', TEST_BIZ);
    await page.fill('[placeholder="Email"]', TEST_EMAIL);
    await page.fill('[placeholder="Password"]', TEST_PASSWORD);
    await shot(page, 'signup-form-filled');

    log('📤', 'Submitting signup');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    await waitForNoSpinner(page);
    await shot(page, 'after-signup');

    // Confirm we made it to the dashboard
    const url = page.url();
    if (!url.includes('dashboard') && !url.includes('localhost:5173')) {
      throw new Error(`Signup may have failed — URL: ${url}`);
    }
    log('✅', 'Signed up + landed in dashboard', `as ${TEST_EMAIL}`);

    // ── 2. ONBOARDING WIZARD ──────────────────────────────────────────────────
    log('⏩', 'Handling onboarding wizard');
    await page.waitForTimeout(1000);

    // Try "Skip for now" button
    const skipBtn = await page.$('button:has-text("Skip for now"), button:has-text("Skip")');
    if (skipBtn && await skipBtn.isVisible()) {
      await skipBtn.click();
      await page.waitForTimeout(1000);
      log('✅', 'Skipped onboarding wizard');
    } else {
      log('ℹ️', 'No onboarding wizard found or already skipped');
    }
    await shot(page, 'dashboard-main');

    // ── 3. OVERVIEW ──────────────────────────────────────────────────────────
    currentSection = 'overview';
    log('\n📊', '=== OVERVIEW ===');
    await navTo(page, 'overview', 'Overview');
    await page.waitForTimeout(1000);
    await waitForNoSpinner(page);
    const overviewOk = await checkForErrors(page, 'Overview');
    if (overviewOk) log('✅', 'Overview loaded');
    // Click week nav arrows
    await clickIfExists(page, 'button:has([class*="ChevronLeft"]), button:has([data-lucide="chevron-left"])', 'Overview prev week');
    await clickIfExists(page, 'button:has([class*="ChevronRight"]), button:has([data-lucide="chevron-right"])', 'Overview next week');
    // Quick action cards
    await clickIfExists(page, 'button:has-text("Customers & Leads")', 'Overview → Customers shortcut');
    await navTo(page, 'overview', 'Overview'); // back
    await clickIfExists(page, 'button:has-text("AI Agents"), button:has-text("AI Agent")', 'Overview → AI Agents shortcut');
    await navTo(page, 'overview', 'Overview');
    await shot(page, 'overview');

    // ── 4. MY WEBSITE ────────────────────────────────────────────────────────
    currentSection = 'website';
    log('\n🌐', '=== MY WEBSITE ===');
    await navTo(page, 'website', 'My Website');
    await page.waitForTimeout(1500);
    await waitForNoSpinner(page);
    const websiteOk = await checkForErrors(page, 'My Website');
    if (websiteOk) log('✅', 'My Website loaded');
    await shot(page, 'website');
    // Look for "Generate Website" or "Edit Website" buttons
    await clickIfExists(page, 'button:has-text("Generate"), button:has-text("Create Website")', 'Website generate button');
    await page.waitForTimeout(500);
    await shot(page, 'website-after-action');

    // ── 5. BOOKING CALENDAR ─────────────────────────────────────────────────
    currentSection = 'booking-calendar';
    log('\n📅', '=== BOOKING CALENDAR ===');
    await navTo(page, 'booking-calendar', 'Booking Calendar');
    await page.waitForTimeout(1200);
    await waitForNoSpinner(page);
    const calOk = await checkForErrors(page, 'Booking Calendar');
    if (calOk) log('✅', 'Booking Calendar loaded');
    await shot(page, 'booking-calendar');
    // Try month/week/day view toggles
    await clickIfExists(page, 'button:has-text("Month")', 'Calendar Month view');
    await clickIfExists(page, 'button:has-text("Week")', 'Calendar Week view');
    await clickIfExists(page, 'button:has-text("Day")', 'Calendar Day view');
    await clickIfExists(page, 'button:has-text("List")', 'Calendar List view');
    // Try nav
    await clickIfExists(page, 'button:has-text("Today")', 'Calendar Today');
    await shot(page, 'booking-calendar-actions');

    // ── 6. CUSTOMERS & LEADS ─────────────────────────────────────────────────
    currentSection = 'customers-leads';
    log('\n👥', '=== CUSTOMERS & LEADS ===');
    await navTo(page, 'customers-leads', 'Customers & Leads');
    await page.waitForTimeout(1200);
    await waitForNoSpinner(page);
    const leadsOk = await checkForErrors(page, 'Customers & Leads');
    if (leadsOk) log('✅', 'Customers & Leads loaded');
    await shot(page, 'customers-leads');
    // Try Add Customer button
    await clickIfExists(page, 'button:has-text("Add Customer"), button:has-text("Add Lead"), button:has-text("New Customer")', 'Add Customer');
    await page.waitForTimeout(400);
    // Close any modal that opened
    await clickIfExists(page, 'button:has-text("Cancel"), button[aria-label="Close"], button:has-text("×")', 'Close modal');
    await shot(page, 'customers-leads-actions');

    // ── 7. AI AGENTS ─────────────────────────────────────────────────────────
    currentSection = 'ai-agents';
    log('\n🤖', '=== AI AGENTS ===');
    await navTo(page, 'ai-agents', 'AI Agents');
    await page.waitForTimeout(1500);
    await waitForNoSpinner(page);
    const aiOk = await checkForErrors(page, 'AI Agents');
    if (aiOk) log('✅', 'AI Agents loaded');
    await shot(page, 'ai-agents');

    // Click each agent card / tab
    const agentCards = await page.$$('button:has-text("Lead Form"), button:has-text("Website Chat"), button:has-text("Missed Call"), [role="tab"]');
    for (const card of agentCards) {
      try {
        if (await card.isVisible()) {
          const txt = await card.textContent();
          await card.click();
          await page.waitForTimeout(800);
          log('🖱️', `AI Agents tab: ${txt.trim().slice(0, 40)}`);
        }
      } catch {}
    }
    await shot(page, 'ai-agents-tabs');

    // ── 8. EMAIL MARKETING ───────────────────────────────────────────────────
    currentSection = 'email-campaigns';
    log('\n📧', '=== EMAIL MARKETING ===');
    await navTo(page, 'email-campaigns', 'Email Marketing');
    await page.waitForTimeout(1200);
    await waitForNoSpinner(page);
    const emailOk = await checkForErrors(page, 'Email Marketing');
    if (emailOk) log('✅', 'Email Marketing loaded');
    await shot(page, 'email-campaigns');
    await clickIfExists(page, 'button:has-text("New Campaign"), button:has-text("Create Campaign")', 'New Email Campaign');
    await page.waitForTimeout(400);
    await clickIfExists(page, 'button:has-text("Cancel"), button:has-text("Close")', 'Close modal');
    await shot(page, 'email-campaigns-action');

    // ── 9. GOOGLE BUSINESS ───────────────────────────────────────────────────
    currentSection = 'google-business';
    log('\n📍', '=== GOOGLE BUSINESS ===');
    await navTo(page, 'google-business', 'Google Business');
    await page.waitForTimeout(1200);
    await waitForNoSpinner(page);
    const gbpOk = await checkForErrors(page, 'Google Business');
    if (gbpOk) log('✅', 'Google Business loaded');
    await shot(page, 'google-business');

    // ── 10. UPSELL POTENTIAL (MARKET RESEARCH) ────────────────────────────────
    currentSection = 'market-research';
    log('\n📈', '=== UPSELL POTENTIAL ===');
    await navTo(page, 'market-research', 'Upsell Potential');
    await page.waitForTimeout(1500);
    await waitForNoSpinner(page);
    const mktOk = await checkForErrors(page, 'Upsell Potential');
    if (mktOk) log('✅', 'Upsell Potential loaded');
    await shot(page, 'market-research');
    await clickIfExists(page, 'button:has-text("Analyze"), button:has-text("Generate"), button:has-text("Research")', 'Market Research action');
    await page.waitForTimeout(500);
    await shot(page, 'market-research-action');

    // ── 11. BUSINESS SETTINGS ────────────────────────────────────────────────
    currentSection = 'business-settings';
    log('\n🏢', '=== BUSINESS SETTINGS ===');
    await navTo(page, 'business-settings', 'Business Settings');
    await page.waitForTimeout(1200);
    await waitForNoSpinner(page);
    const bizOk = await checkForErrors(page, 'Business Settings');
    if (bizOk) log('✅', 'Business Settings loaded');
    await shot(page, 'business-settings');
    // Try tabs: Business Info, Business Hours
    await clickIfExists(page, 'button:has-text("Business Hours"), button:has-text("Hours")', 'Business Hours tab');
    await page.waitForTimeout(400);
    await clickIfExists(page, 'button:has-text("Business Info"), button:has-text("Information")', 'Business Info tab');
    await shot(page, 'business-settings-tabs');

    // ── 12. PAYMENT SETTINGS ─────────────────────────────────────────────────
    currentSection = 'payment-settings';
    log('\n💳', '=== PAYMENT SETTINGS ===');
    await navTo(page, 'payment-settings', 'Payment Settings');
    await page.waitForTimeout(1200);
    await waitForNoSpinner(page);
    const payOk = await checkForErrors(page, 'Payment Settings');
    if (payOk) log('✅', 'Payment Settings loaded');
    await shot(page, 'payment-settings');
    // Sub-tabs
    for (const tab of ['Invoices', 'Estimates', 'Transactions', 'Processors']) {
      await clickIfExists(page, `button:has-text("${tab}")`, `Payment → ${tab}`);
      await page.waitForTimeout(600);
      await waitForNoSpinner(page);
      await checkForErrors(page, `Payment → ${tab}`);
    }
    await shot(page, 'payment-settings-tabs');

    // ── 13. BILLING ──────────────────────────────────────────────────────────
    currentSection = 'billing';
    log('\n🧾', '=== BILLING ===');
    await navTo(page, 'billing', 'Billing');
    await page.waitForTimeout(1500);
    await waitForNoSpinner(page);
    const billingOk = await checkForErrors(page, 'Billing');
    if (billingOk) log('✅', 'Billing loaded');
    await shot(page, 'billing');
    // Click plan cards (but don't submit payment)
    const planBtns = await page.$$('button:has-text("Select"), button:has-text("Choose"), button:has-text("Upgrade")');
    if (planBtns.length) {
      await planBtns[0].click();
      await page.waitForTimeout(600);
      log('🖱️', `Clicked first plan button`);
      await clickIfExists(page, 'button:has-text("Cancel"), button:has-text("Close"), button:has-text("Back")', 'Close plan modal');
    }
    await shot(page, 'billing-plans');

    // ── 14. SETTINGS ─────────────────────────────────────────────────────────
    currentSection = 'settings';
    log('\n⚙️', '=== SETTINGS ===');
    await navTo(page, 'settings', 'Settings');
    await page.waitForTimeout(1000);
    await waitForNoSpinner(page);
    const settingsOk = await checkForErrors(page, 'Settings');
    if (settingsOk) log('✅', 'Settings loaded');
    await shot(page, 'settings');
    // Tabs: Account, Security, Notifications
    for (const tab of ['Account', 'Security', 'Notifications']) {
      await clickIfExists(page, `button:has-text("${tab}")`, `Settings → ${tab}`);
      await page.waitForTimeout(400);
      await checkForErrors(page, `Settings → ${tab}`);
    }
    await shot(page, 'settings-tabs');

    // ── 15. AI AGENTS — DEEP DIVE ────────────────────────────────────────────
    log('\n🤖', '=== AI AGENTS DEEP DIVE ===');
    await navTo(page, 'ai-agents', 'AI Agents');
    await page.waitForTimeout(1200);

    // Click "Lead Form Agent" configure/setup
    await clickIfExists(page, 'button:has-text("Configure"), button:has-text("Setup"), button:has-text("Lead Form Agent")', 'Lead Form Agent configure');
    await page.waitForTimeout(800);
    await checkForErrors(page, 'Lead Form Agent');
    await shot(page, 'ai-agents-lead-form');

    // Back to agents list
    await clickIfExists(page, 'button:has-text("Back"), button:has-text("← Back")', 'Back from Lead Form');
    await page.waitForTimeout(400);

    // Website Chat Agent
    await clickIfExists(page, 'button:has-text("Website Chat"), button:has-text("Chat Agent")', 'Website Chat Agent');
    await page.waitForTimeout(800);
    await checkForErrors(page, 'Website Chat Agent');
    await shot(page, 'ai-agents-website-chat');

    await clickIfExists(page, 'button:has-text("Back"), button:has-text("← Back")', 'Back from Chat Agent');
    await page.waitForTimeout(400);

    // Missed Call Text-Back
    await clickIfExists(page, 'button:has-text("Missed Call"), button:has-text("Text-Back")', 'Missed Call Text-Back');
    await page.waitForTimeout(800);
    await checkForErrors(page, 'Missed Call Text-Back');
    await shot(page, 'ai-agents-missed-call');

  } catch (err) {
    log('💥', 'FATAL ERROR', err.message);
    await shot(page, 'fatal-error');
  } finally {
    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('📋  DASHBOARD CHECK SUMMARY');
    console.log('═'.repeat(60));

    const passes = results.filter(r => r.icon === '✅').length;
    const fails = results.filter(r => r.icon === '❌').length;
    const fatals = results.filter(r => r.icon === '💥').length;

    console.log(`✅  Passed: ${passes}`);
    console.log(`❌  Failed: ${fails}`);
    console.log(`💥  Fatal:  ${fatals}`);

    if (fails > 0 || fatals > 0) {
      console.log('\nIssues found:');
      results.filter(r => ['❌', '💥'].includes(r.icon))
        .forEach(r => console.log(`  ${r.icon} ${r.label}${r.detail ? ': ' + r.detail : ''}`));
    }

    if (consoleErrors.length > 0) {
      console.log(`\n🔴  Browser console errors (${consoleErrors.length}):`);
      [...new Set(consoleErrors)].slice(0, 15).forEach(e => console.log(`   • ${e.slice(0, 120)}`));
    } else {
      console.log('\n🟢  No browser console errors');
    }

    if (failedRequests.length > 0) {
      console.log(`\n🟠  Failed HTTP requests (${failedRequests.length}):`);
      failedRequests.forEach(r => console.log(`   • [${r.status}] ${r.url}  (in: ${r.section})`));
    }

    console.log(`\n📸  Screenshots saved to: scripts/screenshots/`);
    console.log(`🔑  Test account: ${TEST_EMAIL} / ${TEST_PASSWORD}`);
    console.log('═'.repeat(60));

    await browser.close();
  }
})();
