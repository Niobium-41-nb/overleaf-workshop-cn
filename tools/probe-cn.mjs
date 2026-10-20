// Network probe: verify cn.overleaf.com behaves like the official instance.
const targets = [
  'https://cn.overleaf.com/',
  'https://cn.overleaf.com/login',
  'https://cn.overleaf.com/project',
];

for (const url of targets) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (probe)' } });
    const body = await res.text();
    const out = {
      url,
      status: res.status,
      location: res.headers.get('location'),
      setCookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).slice(0, 4),
      bytes: body.length,
      title: (body.match(/<title>([^<]*)<\/title>/) || [])[1] ?? null,
      hasCsrfInput: /name="_csrf"/.test(body),
      captchaHints: ['hcaptcha', 'recaptcha', 'turnstile', 'geetest', 'aliyunCaptcha']
        .filter(k => new RegExp(k, 'i').test(body)),
      socketIoHint: /socket\.io/.test(body),
    };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ url, error: e.message, cause: e.cause?.code ?? null }));
  }
}
