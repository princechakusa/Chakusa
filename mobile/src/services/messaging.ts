import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
const digitsOnly = (phone: string) => phone.replace(/\D/g, '');
export const copyMessage = (message: string) => Clipboard.setStringAsync(message);
export const openSms = (phone: string, message: string) => Linking.openURL(`sms:${phone}?body=${encodeURIComponent(message)}`);
export const openWhatsApp = (phone: string, message: string) => Linking.openURL(`https://wa.me/${digitsOnly(phone)}?text=${encodeURIComponent(message)}`);
export const openCall = (phone: string) => Linking.openURL(`tel:${digitsOnly(phone)}`);
