// Evaluated in the browser. Expose control IDs and browser autofill state only.
export const browserInteractionCode = String.raw`(attribute) => {
  const parseUrl = value => {
    try { return new URL(value, location.href); }
    catch { return undefined; }
  };
  const visible = el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width >= 2 && rect.height >= 2 && style.visibility === 'visible' && style.opacity !== '0' && !el.matches(':disabled,[aria-disabled="true"]');
  };
  const fields = [...document.querySelectorAll('input[type="password" i],[autocomplete~="current-password" i],[autocomplete~="new-password" i],[autocomplete~="one-time-code" i]')].filter(visible);
  if (fields.some(el => el.matches('[autocomplete~="one-time-code" i]'))) return { blocker: 'verification' };
  if (fields.length) {
    const field = fields[0], form = field.form;
    if (fields.length === 1 && field.matches('input[type="password" i]:autofill:not([autocomplete~="new-password" i])') && form) {
      const buttons = [...form.elements].filter(el => el.type === 'submit' && visible(el));
      const button = buttons.length === 1 ? buttons[0] : undefined;
      if (button) {
        const id = button.getAttribute(attribute);
        const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
        const destination = parseUrl(button.hasAttribute('formaction') ? button.formAction : form.action);
        const method = button.getAttribute('formmethod') || form.method;
        const target = button.getAttribute('formtarget') || form.target;
        if (id && /^(?:sign[ -]?in|log[ -]?in|登录|登入|登錄)$/i.test(label) && location.protocol === 'https:' && destination?.origin === location.origin
          && !destination.username && !destination.password && method.toLowerCase() === 'post' && (!target || target.toLowerCase() === '_self')) return { login: id };
      }
    }
    return { blocker: 'login' };
  }
  const navigation = [...document.querySelectorAll('a[href][' + attribute + ']')].filter(el => {
    if (!visible(el) || el.hasAttribute('download') || el.hasAttribute('ping') || el.hasAttribute('onclick') || el.getAttribute('role') === 'button') return false;
    if (el.target && el.target.toLowerCase() !== '_self') return false;
    const url = parseUrl(el.href);
    if (!url || !/^https?:$/.test(url.protocol) || url.origin !== location.origin || url.username || url.password) return false;
    return !/delete|remove|logout|log[ -]?out|sign[ -]?out|submit|publish|pay|unsubscribe|授权|删除|退出|注销|提交|支付|发布/i.test(url.pathname + url.search + ' ' + (el.getAttribute('aria-label') || el.textContent || ''));
  }).map(el => el.getAttribute(attribute));
  return { navigation };
}`

export type BrowserInteraction = {
  blocker?: 'login' | 'verification'
  login?: string
  navigation?: string[]
}

export type BrowserHandoff = { kind: 'login' | 'verification'; host?: string }

export function browserHost(url?: string): string | undefined {
  try { return url ? new URL(url).hostname || undefined : undefined }
  catch { return undefined }
}
