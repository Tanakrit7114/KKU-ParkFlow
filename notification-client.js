// Sends the admin notification queue through the deployed Supabase Edge Function.
// Provider credentials stay inside the Edge Function; they must never reach the browser.
const installNotificationSender = () => {
  const queuedDecideCloudReport = window.decideCloudReport;
  if (!queuedDecideCloudReport || window.kkuNotificationSenderInstalled || window.kkuDirectEmailDecision) return Boolean(queuedDecideCloudReport);
  window.kkuNotificationSenderInstalled = true;

  const findNotification = async reportId => {
    const { data, error } = await window.kkuSupabase
      .from('notification_queue')
      .select('id,status,recipient_email')
      .eq('report_id', reportId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  const notificationErrorText = async result => {
    if (result?.data?.error) return String(result.data.error);
    const response = result?.error?.context;
    if (response?.clone) {
      try {
        const payload = await response.clone().json();
        if (payload?.error) return String(payload.error);
      } catch (_error) {}
    }
    return result?.error?.message || 'ส่งอีเมลไม่สำเร็จ';
  };

  const invokeNotification = async notification => {
    if (!notification?.recipient_email) return { status: 'NO_RECIPIENT', message: 'ยังไม่พบอีเมลผู้รับ' };
    if (notification.status === 'SENT') return { status: 'SENT', message: 'ส่งอีเมลไปแล้ว' };
    const { data: sent, error: sendError } = await window.kkuSupabase.functions.invoke('send-notification', {
      body: { notificationId: notification.id },
    });
    if (sendError || sent?.error) {
      throw Error(await notificationErrorText({ data: sent, error: sendError }));
    }
    return sent || { status: 'SENT', message: 'ส่งอีเมลแล้ว' };
  };

  window.retryCloudNotification = async notificationId => {
    if (!window.kkuSupabase || !notificationId) throw Error('ไม่พบรายการอีเมล');
    const { data: notification, error } = await window.kkuSupabase
      .from('notification_queue')
      .select('id,status,recipient_email')
      .eq('id', notificationId)
      .single();
    if (error) throw error;
    return invokeNotification(notification);
  };

  window.decideCloudReport = async (id, status, action, note = '') => {
    const result = await queuedDecideCloudReport(id, status, action, note);
    if (status !== 'APPROVED' || action !== 'EMAIL' || !window.kkuSupabase) return result;
    try {
      const notification = await findNotification(id);
      if (!notification?.recipient_email || notification?.status === 'NO_RECIPIENT') return result;
      const sent = await invokeNotification(notification);
      return { ...result, result: sent.message || `ส่งอีเมลไปที่ ${notification.recipient_email} แล้ว` };
    } catch (error) {
      return { ...result, result: `${result.result} แต่ส่งอีเมลจริงไม่สำเร็จ: ${error.message || 'กรุณาตรวจสอบการตั้งค่าอีเมล'}` };
    }
  };
  return true;
};

if (!installNotificationSender()) {
  const waitForSupabase = window.setInterval(() => {
    if (installNotificationSender()) window.clearInterval(waitForSupabase);
  }, 100);
  window.setTimeout(() => window.clearInterval(waitForSupabase), 15000);
}
