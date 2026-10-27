/* Gate SG para o site estático: dados e app só carregam após a sessão do servidor. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const gate = el('sgGate'), dashboard = el('dashboardRoot'), emailForm = el('sgEmailForm'), otpForm = el('sgOtpForm');
  let loading = false, loaded = false, checking = false;
  const messages = {
    corporate_only: 'Use seu e-mail corporativo @ebm.com.br.',
    invalid_otp: 'Código inválido ou expirado.',
    security_unavailable: 'O acesso está temporariamente indisponível. Tente novamente mais tarde.',
  };
  function busy(value) {
    loading = value;
    gate.setAttribute('aria-busy', String(value));
    gate.querySelectorAll('button, input').forEach(input => { input.disabled = value; });
  }
  async function api(action, body) {
    const r = await fetch('/api/security/' + action, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json();
    if (!r.ok || data.ok === false) throw new Error(messages[data.reason] || 'Não foi possível validar o acesso. Tente novamente.');
    return data;
  }
  async function state() {
    const session = await api('state');
    if (!session.authenticated && !session.publicAccess) {
      if (loaded) { location.reload(); return; }
      gate.hidden = false; dashboard.hidden = true;
      emailForm.hidden = false; otpForm.hidden = true;
      el('sgMessage').textContent = 'Acesso restrito à equipe autorizada.';
      return false;
    }
    el('sgSessionEmail').textContent = session.email || '';
    el('sgLogout').closest('.settings-row').hidden = Boolean(session.publicAccess);
    if (!loaded) {
      el('sgMessage').textContent = 'Carregando dashboard…';
      // A página precisa estar visível para o Leaflet medir o tamanho do mapa.
      dashboard.hidden = false;
      for (const placeholder of document.querySelectorAll('script[data-sg-src]')) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = placeholder.dataset.sgSrc;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Não foi possível carregar os dados. Recarregue a página para tentar novamente.'));
          document.body.appendChild(script);
        });
      }
      loaded = true;
    }
    gate.hidden = true; dashboard.hidden = false;
    return true;
  }
  emailForm.onsubmit = async event => {
    event.preventDefault(); if (loading) return;
    busy(true); el('sgError').textContent = '';
    try {
      await api('request-otp', { email: el('sgEmailInput').value.trim() });
      emailForm.hidden = true; otpForm.hidden = false;
      el('sgMessage').textContent = 'Se autorizado, seu e-mail receberá o código. Confira também a caixa de spam.';
    } catch (err) { el('sgError').textContent = err.message; }
    finally { busy(false); if (!otpForm.hidden) el('sgOtpInput').focus(); }
  };
  otpForm.onsubmit = async event => {
    event.preventDefault(); if (loading) return;
    busy(true); el('sgError').textContent = '';
    try {
      await api('verify-otp', { email: el('sgEmailInput').value.trim(), otp: el('sgOtpInput').value.trim() });
      if (!(await state())) throw new Error('Sessão indisponível. Solicite um novo código.');
      el('sgOtpInput').value = '';
    } catch (err) { dashboard.hidden = true; gate.hidden = false; el('sgError').textContent = err.message; }
    finally { busy(false); }
  };
  el('sgChangeEmail').onclick = () => {
    otpForm.hidden = true; emailForm.hidden = false; el('sgOtpInput').value = ''; el('sgError').textContent = '';
    el('sgEmailInput').focus();
  };
  el('sgLogout').onclick = async event => {
    event.target.disabled = true;
    try {
      await api('logout', {});
      localStorage.removeItem('ofDashboardAIKey');
      location.reload();
    } catch (err) { alert(err.message); event.target.disabled = false; }
  };
  async function recheck() {
    if (!loaded || checking || document.hidden) return;
    checking = true;
    try { await state(); }
    catch { dashboard.hidden = true; gate.hidden = false; el('sgError').textContent = messages.security_unavailable; }
    finally { checking = false; }
  }
  document.addEventListener('visibilitychange', recheck);
  setInterval(recheck, 60000);
  state().catch(err => {
    dashboard.hidden = true; gate.hidden = false; emailForm.hidden = false;
    el('sgMessage').textContent = 'Acesso restrito à equipe autorizada.';
    el('sgError').textContent = err.message;
  });
})();
