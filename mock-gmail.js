const mockGmailEsc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const mockGmailIsAdmin = () => ['admin', 'super_admin'].includes(window.currentKKUProfile?.role);
let mockGmailContacts = [];
let mockGmailMessages = [];

function ensureMockGmailPanel() {
  const admin = document.querySelector('#admin');
  if (!admin || document.querySelector('#mock-gmail-panel') || !mockGmailIsAdmin()) return;
  const panel = document.createElement('section');
  panel.id = 'mock-gmail-panel';
  panel.className = 'mock-gmail-panel';
  panel.innerHTML = `<div class="mock-gmail-head"><div><span class="eyebrow">DATABASE MAILBOX</span><h3>Mock Gmail</h3><p>จำลองการส่งอีเมลด้วยข้อมูลในฐานข้อมูล เพิ่มผู้รับเองได้ และดูประวัติการส่งได้ทันที</p></div><span class="mock-gmail-badge">MOCK ONLY</span></div><div class="mock-gmail-grid"><form id="mock-gmail-contact-form" class="mock-gmail-add"><label>เพิ่มผู้รับอีเมล</label><div class="mock-gmail-inputs"><input id="mock-gmail-name" required maxlength="100" placeholder="ชื่อผู้รับ เช่น เจ้าของรถ" /><input id="mock-gmail-email" required type="email" maxlength="160" placeholder="example@gmail.com" /><button class="filter-btn" type="submit">＋ เพิ่มผู้รับ</button></div><small>อีเมลนี้จะถูกใช้ใน Mock Gmail เท่านั้น ยังไม่ส่งออกไปยัง Gmail จริง</small></form><div class="mock-gmail-select"><label for="mock-gmail-recipient">ผู้รับสำหรับรายงานถัดไป</label><select id="mock-gmail-recipient"><option value="">กำลังโหลดรายชื่อ...</option></select><small>เลือกผู้รับก่อนกด “ส่ง Mock Gmail” ในคิวตรวจสอบ</small></div></div><div id="mock-gmail-status" class="mock-gmail-status" aria-live="polite"></div><div class="mock-gmail-columns"><div><h4>รายชื่อผู้รับ</h4><div id="mock-gmail-contacts" class="mock-gmail-list"></div></div><div><h4>ข้อความที่ส่งล่าสุด</h4><div id="mock-gmail-messages" class="mock-gmail-list"></div></div></div>`;
  admin.insertBefore(panel, admin.querySelector('.penalty'));
  panel.querySelector('#mock-gmail-contact-form').onsubmit = addMockGmailContact;
  panel.querySelector('#mock-gmail-recipient').onchange = event => {
    window.mockGmailSelectedContactId = event.target.value;
  };
}

function renderMockGmail() {
  const select = document.querySelector('#mock-gmail-recipient');
  const contacts = document.querySelector('#mock-gmail-contacts');
  const messages = document.querySelector('#mock-gmail-messages');
  if (!select || !contacts || !messages) return;
  select.innerHTML = mockGmailContacts.length
    ? `<option value="">เลือกผู้รับก่อนส่ง</option>${mockGmailContacts.map(contact => `<option value="${mockGmailEsc(contact.id)}">${mockGmailEsc(contact.display_name)} · ${mockGmailEsc(contact.email)}</option>`).join('')}`
    : '<option value="">ยังไม่มีผู้รับ เพิ่มรายชื่อด้านบนก่อน</option>';
  if (window.mockGmailSelectedContactId && mockGmailContacts.some(contact => contact.id === window.mockGmailSelectedContactId)) select.value = window.mockGmailSelectedContactId;
  else if (mockGmailContacts[0]) { window.mockGmailSelectedContactId = mockGmailContacts[0].id; select.value = mockGmailContacts[0].id; }
  contacts.innerHTML = mockGmailContacts.length ? mockGmailContacts.map(contact => `<div class="mock-gmail-row"><b>${mockGmailEsc(contact.display_name)}</b><small>${mockGmailEsc(contact.email)}</small></div>`).join('') : '<p class="mock-gmail-empty">ยังไม่มีรายชื่อผู้รับ</p>';
  messages.innerHTML = mockGmailMessages.length ? mockGmailMessages.map(message => `<div class="mock-gmail-row"><b>${mockGmailEsc(message.recipient_name || message.recipient_email)}</b><small>${mockGmailEsc(message.subject)} · ${message.sent_at ? new Date(message.sent_at).toLocaleString('th-TH') : 'ยังไม่ส่ง'}</small><span class="mock-mail-status">${mockGmailEsc(message.status)}</span></div>`).join('') : '<p class="mock-gmail-empty">ยังไม่มีข้อความที่ส่ง</p>';
  document.querySelectorAll('.decision-action option[value="EMAIL"]').forEach(option => { option.textContent = 'ส่ง Mock Gmail'; });
}

async function loadMockGmail() {
  if (!window.kkuSupabase || !mockGmailIsAdmin()) return;
  ensureMockGmailPanel();
  const [contactResult, messageResult] = await Promise.all([
    window.kkuSupabase.from('mock_gmail_contacts').select('id,email,display_name,active').eq('active', true).order('created_at', { ascending: false }),
    window.kkuSupabase.from('mock_gmail_messages').select('id,recipient_email,recipient_name,subject,status,sent_at').order('created_at', { ascending: false }).limit(10),
  ]);
  const status = document.querySelector('#mock-gmail-status');
  if (contactResult.error || messageResult.error) {
    if (status) status.textContent = 'ยังไม่ได้ติดตั้งตาราง Mock Gmail ใน Supabase';
    return;
  }
  mockGmailContacts = contactResult.data || [];
  mockGmailMessages = messageResult.data || [];
  renderMockGmail();
  if (status) status.textContent = `ผู้รับ ${mockGmailContacts.length} ราย · ข้อความล่าสุด ${mockGmailMessages.length} รายการ`;
}

async function addMockGmailContact(event) {
  event.preventDefault();
  const name = document.querySelector('#mock-gmail-name')?.value.trim();
  const email = document.querySelector('#mock-gmail-email')?.value.trim().toLowerCase();
  const status = document.querySelector('#mock-gmail-status');
  if (!name || !email) return;
  const { error: insertError } = await window.kkuSupabase.from('mock_gmail_contacts').insert({ display_name: name, email, created_by: window.currentKKUUser.id });
  if (insertError) { if (status) status.textContent = insertError.code === '23505' ? 'อีเมลนี้มีอยู่แล้ว' : `เพิ่มผู้รับไม่สำเร็จ: ${insertError.message}`; return; }
  event.target.reset();
  if (status) status.textContent = `เพิ่ม ${email} ใน Mock Gmail แล้ว`;
  await loadMockGmail();
}

window.mockGmailSend = async (reportId, note, previousResult) => {
  const recipient = mockGmailContacts.find(contact => contact.id === window.mockGmailSelectedContactId);
  if (!recipient) return { ...previousResult, result: 'ยืนยันรายงานแล้ว แต่ยังไม่ได้เลือกผู้รับใน Mock Gmail' };
  const { data: report, error: reportError } = await window.kkuSupabase.from('reports').select('description,violation_type,plate_number').eq('id', reportId).single();
  if (reportError) return { ...previousResult, result: `ยืนยันแล้ว แต่โหลดรายละเอียดเพื่อส่ง Mock Gmail ไม่สำเร็จ: ${reportError.message}` };
  const subject = 'แจ้งผลการตรวจสอบการจอดรถจักรยานยนต์ KKU ParkFlow';
  const body = `เรียน ${recipient.display_name}\n\nผลการตรวจสอบ: ${report.description}\nประเภท: ${report.violation_type || '-'}\nทะเบียนรถ: ${report.plate_number || 'ไม่ระบุทะเบียน'}\nหมายเหตุจาก Admin: ${note || '-'}\n\nนี่คือข้อความจำลองในฐานข้อมูล Mock Gmail`;
  const { error: messageError } = await window.kkuSupabase.from('mock_gmail_messages').insert({ report_id: reportId, recipient_email: recipient.email, recipient_name: recipient.display_name, subject, body, status: 'SENT', sent_by: window.currentKKUUser.id, sent_at: new Date().toISOString() });
  if (messageError) return { ...previousResult, result: `ยืนยันแล้ว แต่บันทึก Mock Gmail ไม่สำเร็จ: ${messageError.message}` };
  const { data: queued } = await window.kkuSupabase.from('notification_queue').select('id').eq('report_id', reportId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (queued?.id) await window.kkuSupabase.from('notification_queue').update({ recipient_email: recipient.email, status: 'SENT', sent_at: new Date().toISOString() }).eq('id', queued.id);
  await loadMockGmail();
  return { ...previousResult, result: `บันทึก Mock Gmail ถึง ${recipient.email} แล้ว` };
};

window.addEventListener('cloud-reports-loaded', () => { setTimeout(loadMockGmail, 0); });
setInterval(() => { if (document.querySelector('#admin.active-view') && mockGmailIsAdmin()) { ensureMockGmailPanel(); renderMockGmail(); } }, 700);
