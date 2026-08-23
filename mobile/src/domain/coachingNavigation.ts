import type { SmartAudienceKey } from '../apiTypes';
import type { RootStackParamList } from '../types';

export function audienceCoachingDestination(audienceKey: SmartAudienceKey): {
  screen: 'Main';
  params: NonNullable<RootStackParamList['Main']>;
} {
  return { screen: 'Main', params: { screen: 'Customers', params: { audienceKey } } };
}
