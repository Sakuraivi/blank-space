const status = document.querySelector('#status');
const form = document.querySelector('#config-form');
const keyInput = document.querySelector('#api-key');
const inviteInput = document.querySelector('#invite-code');
const enabledInput = document.querySelector('#enabled');
const errors = { invalid_key: 'Key 格式不正确，请检查后再保存。', invalid_invite: '体验码需为 8–64 位字母、数字或连字符。', activation_unavailable: '请填写 Key 和体验码；价格验证到期时暂不能启用。', secret_unconfigured: '后台秘密存储尚未配置完成。', admin_required: '当前账号没有管理权限，请使用站点所有者账号登录。', service_unavailable: '后台暂时未就绪，请稍后再试。' };
function busy(value) { form.querySelectorAll('button,input').forEach(x => { x.disabled = value; }); }
async function refresh(preserveMessage = false) {
  try {
    const r = await fetch('/api/admin/status', { cache: 'no-store', credentials: 'same-origin' });
    const data = await r.json();
    if (!r.ok) {
      document.querySelector('#login').hidden = r.status !== 403;
      document.querySelector('#settings').hidden = true;
      status.textContent = errors[data.reason] || '暂时无法读取设置。'; return;
    }
    document.querySelector('#login').hidden = true;
    document.querySelector('#settings').hidden = false;
    enabledInput.checked = data.enabled;
    document.querySelector('#usage').textContent = `本批已占用 ${data.usedCalls} 次，还可调用 ${data.remainingCalls} 次。`;
    document.querySelector('#valid-until').textContent = `价格已核对至 2026 年 10 月 30 日。本批价格验证有效期至北京时间 11 月 6 日 00:00；到期自动停用，需重新核对。${data.expired ? '当前已到期。' : ''}`;
    if (!preserveMessage) status.textContent = data.configured ? '凭据已配置；真实模型效果需通过体验验证。' : '还未配置模型。填写后保存，不会立即产生费用。';
  } catch { status.textContent = '暂时无法连接后台，请稍后重试。'; }
}
form.addEventListener('submit', async event => {
  event.preventDefault(); busy(true); status.textContent = '正在保存……';
  try {
    const r = await fetch('/api/admin/config', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: keyInput.value, inviteCode: inviteInput.value, enabled: enabledInput.checked }) });
    const data = await r.json();
    if (!r.ok) { status.textContent = errors[data.reason] || '未能保存，请检查配置后重试。'; return; }
    keyInput.value = ''; inviteInput.value = '';
    status.textContent = '设置已保存。请回首页用体验码完成一次简短测试。';
    await refresh(true);
  } catch { status.textContent = '连接中断，保存结果未确认。请刷新状态后再决定是否重试。'; }
  finally { busy(false); }
});
document.querySelector('#delete-key').addEventListener('click', async () => {
  if (!confirm('删除已保存的模型 Key 和体验码，并关闭 AI？已用测试额度不会重置。')) return;
  busy(true);
  try {
    const r = await fetch('/api/admin/config', { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) throw Error();
    keyInput.value = ''; inviteInput.value = ''; status.textContent = 'Key 已删除，AI 已关闭。'; await refresh(true);
  } catch { status.textContent = '删除结果未确认，请刷新检查。'; }
  finally { busy(false); }
});
await refresh();
