// Compare www vs cn login page structure (no credentials sent).
const re = (s, f = 'gi') => new RegExp(s, f);
const pages = ['https://cn.overleaf.com/login', 'https://www.overleaf.com/login'];

for (const url of pages) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (probe)' } });
    const html = await res.text();
    const forms = [...html.matchAll(re('<form[^>]*>'))].map(m => m[0]);
    const captchaCtx = [...html.matchAll(re('.{100}(?:g-recaptcha|h-captcha|turnstile|geetest|aliyunCaptcha).{160}'))].map(m => m[0].replace(/\s+/g, ' '));
    const sso = [...html.matchAll(re('href="([^"]*(?:sso|institutional|shibboleth)[^"]*)"'))].map(m => m[1]).slice(0, 8);
    const siteKeys = [...html.matchAll(re('data-sitekey="([^"]+)"'))].map(m => m[1]);
    const ssoBtnText = [...html.matchAll(re('(?:Single sign[- ]on|SSO|institution)[^<]{0,60}', 'gi'))].map(m => m[0]).slice(0, 6);
    console.log('==========', url, res.status);
    console.log('forms:', JSON.stringify(forms));
    console.log('captcha ctx:', JSON.stringify(captchaCtx.slice(0, 4), null, 1));
    console.log('sso links:', JSON.stringify(sso));
    console.log('sitekeys:', JSON.stringify(siteKeys));
    console.log('sso text:', JSON.stringify(ssoBtnText));
    const hosts = [...new Set([...html.matchAll(re('https?://([a-z0-9.\\-]+)'))].map(m => m[1]))].sort();
    console.log('external hosts:', JSON.stringify(hosts));
  } catch (e) {
    console.log('ERR', url, e.message);
  }
}
