// Turns the admin notification queue action into a real email send.
// The provider secret stays inside the Supabase Edge Function.
const installNotificationSender = () => {
  const queuedDecideCloudReport = window.decideCloudReport;
  if (!queuedDecideCloudReport || window.kkuNotificationSenderInstalled) return Boolean(queuedDecideCloudReport);
  window.kkuNotificationSenderInstalled = true;
  window.decideCloudReport = async (id, status, action, note = '') => {
    const result = await queuedDecideCloudReport(id, status, action, note);
    if (status !== 'APPROVED' || action !== 'EMAIL' || !window.kkuSupabase) return result;
    if (window.mockGmailSend) return window.mockGmailSend(id, note, result);

    const { data: notification, error: notificationError } = await window.kkuSupabase
      .from('notification_queue')
      .select('id,status,recipient_email')
      .eq('report_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (notificationError) {
      return { ...result, result: `${result.result} แต่ตรวจสอบสถานะอีเมลไม่ได้: ${notificationError.message}` };
    }
    if (!notification?.recipient_email || notification.status !== 'QUEUED') return result;

    const { data: sent, error: sendError } = await window.kkuSupabase.functions.invoke('send-notification', {
      body: { notificationId: notification.id },
    });
    if (sendError || sent?.error) {
      return { ...result, result: `${result.result} แต่ส่งอีเมลไม่สำเร็จ: ${sendError?.message || sent?.error || 'กรุณาตั้งค่าผู้ให้บริการอีเมล'}` };
    }
    return { ...result, result: sent?.message || 'ยืนยันและส่งอีเมลแล้ว' };
  };
  return true;
};

if (!installNotificationSender()) {
  const waitForSupabase = window.setInterval(() => {
    if (installNotificationSender()) window.clearInterval(waitForSupabase);
  }, 100);
  window.setTimeout(() => window.clearInterval(waitForSupabase), 15000);
}
