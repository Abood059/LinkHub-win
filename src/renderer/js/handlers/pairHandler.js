import { showToast } from '../core/utils.js';
import { pairDevice as pairDeviceService } from '../services/deviceService.js';

export async function handlePairDevice(loadDevicesCallback) {
    const host = prompt('أدخل عنوان Pairing (مثال: 192.168.1.10:37000)');
    if (!host) return;
    const code = prompt('أدخل رمز Pairing Component من 6 أرقام');
    if (!code || !/^\d{6}$/.test(code)) {
        showToast('رمز Pairing يجب أن يكون 6 أرقام', true);
        return;
    }
    try {
        await pairDeviceService(host, code);
        showToast('تم Pairing بنجاح! سيظهر device قريباً.');
        if (loadDevicesCallback) loadDevicesCallback();
    } catch (err) {
        showToast(`فشل Pairing: ${err.message}`, true);
    }
}
