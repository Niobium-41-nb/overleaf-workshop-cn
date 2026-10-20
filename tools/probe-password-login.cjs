// One-shot diagnostic: does the CN instance accept the extension's password-only
// login POST (no reCAPTCHA token)? Uses a non-existent address; no account exists.
const path = require('path');
const { BaseAPI } = require(path.join(process.argv[2], 'out/api/base.js'));

const email = `probe-nonexistent-${Math.random().toString(36).slice(2, 10)}@example.invalid`;
const api = new BaseAPI('https://cn.overleaf.com/');
api.passportLogin(email, 'not-a-real-password')
  .then(res => console.log(JSON.stringify({ email, type: res.type, message: res.message }, null, 2)))
  .catch(e => console.log(JSON.stringify({ email, threw: e.message })));
