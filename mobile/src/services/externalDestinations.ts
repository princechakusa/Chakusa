import { Alert, Linking } from 'react-native';
import { ExternalDestination } from '../domain/trustSettings';

export async function openExternalDestination(destination: ExternalDestination, label: string) {
  if (!destination) { Alert.alert(`${label} unavailable`, `${label} has not been configured yet.`); return; }
  const target = destination.kind === 'email' ? `mailto:${destination.value}` : destination.value;
  try {
    if (!await Linking.canOpenURL(target)) throw new Error('unsupported');
    await Linking.openURL(target);
  } catch { Alert.alert(`Couldn’t open ${label.toLowerCase()}`, 'Please try again later.'); }
}

