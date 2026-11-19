// Evaluated inside the observed page. Only a boolean leaves the page.
export const browserChallengeCode = `(() => {
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
  const frames = document.querySelectorAll('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="challenges.cloudflare.com" i],iframe[title*="captcha" i],iframe[title*="验证" i]');
  if (Array.from(frames).some(visible)) return true;
  const text = (document.body?.innerText || '').slice(0, 20000);
  return /请完成(?:安全|人机)?验证|请(?:先)?拖动滑块|验证您是真人|verify you are human|verify you are not a robot|checking your browser before accessing/i.test(text);
})()`
