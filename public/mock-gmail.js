// Admin tools for real email notifications.
// The file name is kept for backwards compatibility with existing deployments.
const emailAdminEsc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const emailAdminIsAdmin = () => ['admin', 'super_admin'].includes(window.currentKKUProfile?.role);
let emailAdminVehicles = [];
let emailAdminNotifications = [];

function ensureEmailAdminPanel() {
  const admin = document.querySelector('#admin');
  if (!admin || document.querySelector('#email-admin-panel') || !emailAdminIsAdmin()) return;
  const panel = document.createElement('section');
  panel.id = 'email-admin-panel';
  panel.className = 'mock-gmail-panel';
  panel.innerHTML = `<div class="mock-gmail-head"><div><span class="eyebrow">REAL EMAIL NOTIFICATIONS</span><h3>ผู้รับอีเมลแจ้งเตือน</h3><p>ผูกทะเบียนรถกับอีเมลเจ้าของรถเพื่อให้ระบบส่งอีเมลจริงหลัง Admin ยืนยันรายงาน</p></div><span class="mock-gmail-badge">SUPABASE QUEUE</span></div><form id="email-vehicle-form" class="mock-gmail-add"><label>เพิ่มหรือแก้ไขข้อมูลเจ้าของรถ</label><div class="mock-gmail-inputs"><input id="email-vehicle-plate" required maxlength="20" placeholder="ทะเบียนรถ เช่น กข 7145" /><input id="email-vehicle-name" required maxlength="120" placeholder="ชื่อเจ้าของรถ" /><input id="email-vehicle-email" required type="email" maxlength="160" placeholder="เจ้าของรถ@gmail.com" /><button class="filter-btn" type="submit">＋ บันทึกผู้รับ</button></div><small>เมื่อเลือก “ส่งอีเมลจริง” ระบบจะใช้ข้อมูลทะเบียนนี้เป็นผู้รับ</small></form><div class="mock-gmail-import"><label for="email-vehicle-csv" class="filter-btn">⇧ นำเข้า CSV</label><input id="email-vehicle-csv" type="file" accept=".csv,text/csv" hidden /><button id="email-vehicle-template" class="filter-btn" type="button">ดาวน์โหลดตัวอย่าง CSV</button><small>คอลัมน์ที่รองรับ: ทะเบียนรถ, ชื่อเจ้าของรถ, อีเมลเจ้าของรถ · ทะเบียนเดิมจะถูกอัปเดต</small></div><div id="email-admin-status" class="mock-gmail-status" aria-live="polite"></div><div class="mock-gmail-columns"><div><h4>ทะเบียนและผู้รับ</h4><div id="email-vehicle-list" class="mock-gmail-list"></div></div><div><h4>คิวอีเมลล่าสุด</h4><div id="email-notification-list" class="mock-gmail-list"></div></div></div>`;
  admin.insertBefore(panel, admin.querySelector('.penalty'));
  panel.querySelector('#email-vehicle-form').onsubmit = saveEmailVehicle;
  panel.querySelector('#email-vehicle-csv').onchange = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) importEmailVehiclesFromCsv(file);
  };
  panel.querySelector('#email-vehicle-template').onclick = downloadEmailVehicleTemplate;
}

const csvHeaderAliases = {
  plate_number: ['ทะเบียนรถ', 'ทะเบียน', 'plate_number', 'plate', 'platenumber'],
  owner_name: ['ชื่อเจ้าของรถ', 'ชื่อเจ้าของ', 'owner_name', 'owner', 'name', 'ownername'],
  owner_email: ['อีเมลเจ้าของรถ', 'อีเมล', 'email', 'owner_email', 'owneremail'],
};

function normalizeCsvHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function parseCsvRows(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = (source.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (source.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === delimiter && !quoted) { row.push(cell); cell = ''; continue; }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some(value => String(value).trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some(value => String(value).trim())) rows.push(row); }
  return rows;
}

function parseEmailVehicleCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('ไฟล์ CSV ต้องมีหัวตารางและข้อมูลอย่างน้อย 1 รายการ');
  const headers = rows.shift().map(normalizeCsvHeader);
  const findColumn = key => headers.findIndex(header => csvHeaderAliases[key].some(alias => normalizeCsvHeader(alias) === header));
  const columns = { plate_number: findColumn('plate_number'), owner_name: findColumn('owner_name'), owner_email: findColumn('owner_email') };
  if (Object.values(columns).some(index => index < 0)) throw new Error('หัวตารางไม่ครบ ต้องมี ทะเบียนรถ, ชื่อเจ้าของรถ และ อีเมลเจ้าของรถ');
  const errors = [], records = new Map();
  rows.forEach((values, rowIndex) => {
    const plate = String(values[columns.plate_number] || '').trim();
    const name = String(values[columns.owner_name] || '').trim();
    const email = String(values[columns.owner_email] || '').trim().toLowerCase();
    if (!plate && !name && !email) return;
    if (!plate || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`แถว ${rowIndex + 2}: ทะเบียน ชื่อ และอีเมลไม่ถูกต้อง`);
      return;
    }
    records.set(plate, { plate_number: plate, owner_name: name, owner_email: email, active: true });
  });
  if (errors.length) throw new Error(errors.slice(0, 3).join(' · ') + (errors.length > 3 ? ` · และอีก ${errors.length - 3} แถว` : ''));
  if (!records.size) throw new Error('ไม่พบข้อมูลที่นำเข้าได้');
  return [...records.values()];
}

async function importEmailVehiclesFromCsv(file) {
  const status = document.querySelector('#email-admin-status');
  try {
    if (!window.kkuSupabase) throw new Error('ยังไม่เชื่อมต่อฐานข้อมูล');
    if (status) status.textContent = `กำลังอ่านไฟล์ ${file.name}…`;
    const records = parseEmailVehicleCsv(await file.text());
    const { error } = await window.kkuSupabase.from('vehicle_registry').upsert(records, { onConflict: 'plate_number' });
    if (error) throw error;
    if (status) status.textContent = `นำเข้าผู้รับ ${records.length} รายการแล้ว`;
    await loadEmailAdminPanel();
  } catch (error) {
    if (status) status.textContent = `นำเข้า CSV ไม่สำเร็จ: ${error.message || 'กรุณาตรวจสอบไฟล์'}`;
  }
}

function downloadEmailVehicleTemplate() {
  const csv = '\uFEFFทะเบียนรถ,ชื่อเจ้าของรถ,อีเมลเจ้าของรถ\r\nกข 7145,Tester,tanakritk21@gmail.com\r\n';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'kku-parkflow-vehicle-registry-template.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function renderEmailAdminPanel() {
  const vehicles = document.querySelector('#email-vehicle-list');
  const notifications = document.querySelector('#email-notification-list');
  if (!vehicles || !notifications) return;
  vehicles.innerHTML = emailAdminVehicles.length
    ? emailAdminVehicles.map(vehicle => `<div class="mock-gmail-row"><b>${emailAdminEsc(vehicle.plate_number)}</b><small>${emailAdminEsc(vehicle.owner_name)} · ${emailAdminEsc(vehicle.owner_email || 'ยังไม่มีอีเมล')}</small></div>`).join('')
    : '<p class="mock-gmail-empty">ยังไม่มีข้อมูลทะเบียนรถ</p>';
  notifications.innerHTML = emailAdminNotifications.length
    ? emailAdminNotifications.map(item => `<div class="mock-gmail-row"><b>${emailAdminEsc(item.recipient_email || 'ไม่มีผู้รับ')}</b><small>${emailAdminEsc(item.subject)} · ${item.created_at ? new Date(item.created_at).toLocaleString('th-TH') : '-'}</small><span class="mock-mail-status">${emailAdminEsc(item.status)}</span>${['FAILED', 'QUEUED'].includes(item.status) && item.recipient_email ? `<button class="email-retry" data-id="${emailAdminEsc(item.id)}">ส่งซ้ำ</button>` : ''}</div>`).join('')
    : '<p class="mock-gmail-empty">ยังไม่มีคิวอีเมล</p>';
  notifications.querySelectorAll('.email-retry').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = 'กำลังส่ง…';
      try {
        const result = await window.retryCloudNotification(button.dataset.id);
        const status = document.querySelector('#email-admin-status');
        if (status) status.textContent = result.message || 'ส่งอีเมลแล้ว';
        await loadEmailAdminPanel();
      } catch (error) {
        const status = document.querySelector('#email-admin-status');
        if (status) status.textContent = `ส่งซ้ำไม่สำเร็จ: ${error.message || 'กรุณาลองใหม่'}`;
        button.disabled = false;
        button.textContent = 'ส่งซ้ำ';
      }
    };
  });
}

async function loadEmailAdminPanel() {
  if (!window.kkuSupabase || !emailAdminIsAdmin()) return;
  ensureEmailAdminPanel();
  const [vehicles, notifications] = await Promise.all([
    window.kkuSupabase.from('vehicle_registry').select('id,plate_number,owner_name,owner_email,active').eq('active', true).order('created_at', { ascending: false }),
    window.kkuSupabase.from('notification_queue').select('id,recipient_email,subject,status,created_at,sent_at').order('created_at', { ascending: false }).limit(12),
  ]);
  const status = document.querySelector('#email-admin-status');
  if (vehicles.error || notifications.error) {
    if (status) status.textContent = `โหลดข้อมูลอีเมลไม่สำเร็จ: ${vehicles.error?.message || notifications.error?.message || 'กรุณาตรวจสอบสิทธิ์'}`;
    return;
  }
  emailAdminVehicles = vehicles.data || [];
  emailAdminNotifications = notifications.data || [];
  renderEmailAdminPanel();
  if (status) status.textContent = `ผู้รับ ${emailAdminVehicles.length} ราย · คิวอีเมล ${emailAdminNotifications.length} รายการ`;
}

async function saveEmailVehicle(event) {
  event.preventDefault();
  const plate = document.querySelector('#email-vehicle-plate')?.value.trim();
  const name = document.querySelector('#email-vehicle-name')?.value.trim();
  const email = document.querySelector('#email-vehicle-email')?.value.trim().toLowerCase();
  const status = document.querySelector('#email-admin-status');
  if (!plate || !name || !email) return;
  const { error } = await window.kkuSupabase.from('vehicle_registry').upsert({ plate_number: plate, owner_name: name, owner_email: email, active: true }, { onConflict: 'plate_number' });
  if (error) { if (status) status.textContent = `บันทึกผู้รับไม่สำเร็จ: ${error.message}`; return; }
  event.target.reset();
  if (status) status.textContent = `บันทึก ${plate} และผู้รับ ${email} แล้ว`;
  await loadEmailAdminPanel();
}

window.addEventListener('cloud-reports-loaded', () => { setTimeout(loadEmailAdminPanel, 0); });
setInterval(() => { if (document.querySelector('#admin.active-view') && emailAdminIsAdmin()) loadEmailAdminPanel(); }, 10000);
