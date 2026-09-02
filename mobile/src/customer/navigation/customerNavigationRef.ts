import { createNavigationContainerRef } from '@react-navigation/native';

import type { CustomerRootStackParamList } from './types';

// PROGRAM 2 LOOP 7: navigation ref for the customer app, separate from the
// business `navigationRef`. Used for deep-link handling and the legal-gate
// document viewer.
export const navigationRef = createNavigationContainerRef<CustomerRootStackParamList>();
