import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CustomerDto, DashboardSummaryDto, FeedbackDto, LeadDto, LeadStatus, MessageTemplateDto, ReminderDto, ReviewRequestDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { customersApi, dashboardApi, feedbackApi, leadsApi, remindersApi, reviewsApi, templatesApi } from '../services/endpoints';
import { useAuth } from './AuthContext';

export type ResourceKey = 'dashboard' | 'customers' | 'leads' | 'reviews' | 'feedback' | 'reminders' | 'templates';
export interface ResourceState { loading: boolean; loaded: boolean; error: string | null; }
const initialResource = (): ResourceState => ({ loading: false, loaded: false, error: null });
const initialStates = (): Record<ResourceKey, ResourceState> => ({ dashboard: initialResource(), customers: initialResource(), leads: initialResource(), reviews: initialResource(), feedback: initialResource(), reminders: initialResource(), templates: initialResource() });
interface AppStateValue { dashboard: DashboardSummaryDto | null; customers: CustomerDto[]; customerTotal: number; leads: LeadDto[]; leadTotal: number; reviews: ReviewRequestDto[]; feedback: FeedbackDto[]; reminders: ReminderDto[]; templates: MessageTemplateDto[]; state: Record<ResourceKey, ResourceState>; loadDashboard: () => Promise<void>; loadCustomers: (search?: string) => Promise<void>; loadLeads: (status?: LeadStatus) => Promise<void>; loadReviews: () => Promise<void>; loadFeedback: () => Promise<void>; loadReminders: () => Promise<void>; loadTemplates: () => Promise<void>; }
const AppState = createContext<AppStateValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const { status } = useAuth(); const [dashboard, setDashboard] = useState<DashboardSummaryDto | null>(null); const [customers, setCustomers] = useState<CustomerDto[]>([]); const [customerTotal, setCustomerTotal] = useState(0); const [leads, setLeads] = useState<LeadDto[]>([]); const [leadTotal, setLeadTotal] = useState(0); const [reviews, setReviews] = useState<ReviewRequestDto[]>([]); const [feedback, setFeedback] = useState<FeedbackDto[]>([]); const [reminders, setReminders] = useState<ReminderDto[]>([]); const [templates, setTemplates] = useState<MessageTemplateDto[]>([]); const [state, setState] = useState(initialStates);
  const run = useCallback(async (key: ResourceKey, operation: () => Promise<void>) => { setState(current => ({ ...current, [key]: { ...current[key], loading: true, error: null } })); try { await operation(); setState(current => ({ ...current, [key]: { loading: false, loaded: true, error: null } })); } catch (error) { setState(current => ({ ...current, [key]: { loading: false, loaded: true, error: error instanceof ApiError ? error.message : 'Unable to load this data.' } })); } }, []);
  const loadDashboard = useCallback(() => run('dashboard', async () => setDashboard(await dashboardApi.summary())), [run]);
  const loadCustomers = useCallback((search = '') => run('customers', async () => { const result = await customersApi.list(search); setCustomers(result.items); setCustomerTotal(result.total); }), [run]);
  const loadLeads = useCallback((leadStatus?: LeadStatus) => run('leads', async () => { const result = await leadsApi.list(leadStatus); setLeads(result.items); setLeadTotal(result.total); }), [run]);
  const loadReviews = useCallback(() => run('reviews', async () => setReviews(await reviewsApi.list())), [run]); const loadFeedback = useCallback(() => run('feedback', async () => setFeedback(await feedbackApi.list())), [run]); const loadReminders = useCallback(() => run('reminders', async () => setReminders(await remindersApi.list())), [run]); const loadTemplates = useCallback(() => run('templates', async () => setTemplates(await templatesApi.list())), [run]);
  useEffect(() => { if (status === 'anonymous') { setDashboard(null); setCustomers([]); setCustomerTotal(0); setLeads([]); setLeadTotal(0); setReviews([]); setFeedback([]); setReminders([]); setTemplates([]); setState(initialStates()); } }, [status]);
  const value = useMemo(() => ({ dashboard, customers, customerTotal, leads, leadTotal, reviews, feedback, reminders, templates, state, loadDashboard, loadCustomers, loadLeads, loadReviews, loadFeedback, loadReminders, loadTemplates }), [customerTotal, customers, dashboard, feedback, leadTotal, leads, loadCustomers, loadDashboard, loadFeedback, loadLeads, loadReminders, loadReviews, loadTemplates, reminders, reviews, state, templates]);
  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}
export function useAppState() { const value = useContext(AppState); if (!value) throw new Error('useAppState must be used within AppProvider'); return value; }
