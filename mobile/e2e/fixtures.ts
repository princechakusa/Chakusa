import { expect, test as base } from '@playwright/test';

// In watch mode (npm run e2e:watch) every page shows a slim caption naming
// the test being run, so a person following along always knows what they
// are looking at. It ignores the mouse, stays out of iframes (the maps), and
// renders its text via CSS ::after so no assertion can ever match it as
// app text. Headless runs are untouched.

export const test = base.extend<{ caption: void }>({
  caption: [async ({ page }, use, testInfo) => {
    if (process.env.E2E_WATCH === '1') {
      await page.addInitScript((title) => {
        if (window.top !== window) return;
        const add = () => {
          if (document.getElementById('e2e-caption')) return;
          const style = document.createElement('style');
          style.textContent = '#e2e-caption{position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;'
            + 'background:rgba(14,17,22,.82);color:#fff;font:600 11px/1.3 system-ui,sans-serif;padding:4px 8px}'
            + '#e2e-caption::after{content:attr(data-caption)}';
          const bar = document.createElement('div');
          bar.id = 'e2e-caption';
          bar.setAttribute('aria-hidden', 'true');
          bar.setAttribute('data-caption', `TESTING ▶ ${title}`);
          document.documentElement.append(style, bar);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
      }, testInfo.title);
    }
    await use();
  }, { auto: true }],
});

export { expect };
