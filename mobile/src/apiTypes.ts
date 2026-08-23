export type LeadStatus = 'new' | 'contacted' | 'booked' | 'won' | 'lost';
export type AutomationTriggerType = 'LEAD_CREATED' | 'LEAD_FOLLOW_UP' | 'REVIEW_REQUEST_FOLLOW_UP' | 'CUSTOMER_RETENTION';
export type AutomationChannel = 'SMS' | 'WHATSAPP';
export type AutomationRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export interface AutomationRuleDto { id: string; businessId: string; name: string; enabled: boolean; triggerType: AutomationTriggerType; channel: AutomationChannel; delaySeconds: number; config: Record<string, unknown>; createdAt: string; updatedAt: string; }
export type AutomationRunReason = 'INVALID_PHONE' | 'CUSTOMER_OPTED_OUT' | 'SUBSCRIPTION_INACTIVE' | 'LEAD_ALREADY_CONTACTED' | 'RULE_DISABLED' | 'SEND_FAILED' | 'UNKNOWN';
export interface AutomationRunHistoryItemDto { id: string; status: AutomationRunStatus; scheduledFor: string; startedAt: string | null; completedAt: string | null; triggerType: AutomationTriggerType; channel: AutomationChannel; customer: { id: string; name: string } | null; lead: { id: string; serviceRequested: string | null; status: LeadStatus } | null; reason: AutomationRunReason | null; }
export interface AutomationRunHistoryDto { items: AutomationRunHistoryItemDto[]; total: number; page: number; pageSize: number; }
export type LeadUrgency = 'low' | 'medium' | 'high';
export type ReviewStatus = 'pending' | 'sent' | 'opened' | 'reviewed' | 'feedback_received';
export type ReminderStatus = 'due' | 'sent' | 'completed' | 'dismissed';
export type FeedbackStatus = 'new' | 'acknowledged' | 'resolved';
export type FeedbackSentiment = 'positive' | 'neutral' | 'negative';
export type MessageTone = 'friendly' | 'professional' | 'casual';
export type MessageType = 'missed_call' | 'booking_confirmation' | 'review_request' | 'private_feedback' | 'comeback_reminder' | 'custom' | 'public_profile_inquiry' | 'lead_follow_up';
export type MessageChannel = 'sms' | 'whatsapp' | 'call' | 'email' | 'other';
export type MessageStatus = 'draft' | 'copied' | 'sent' | 'failed';
export type ActivityEventType = 'LEAD_CREATED' | 'LEAD_CONTACTED' | 'LEAD_BOOKED' | 'LEAD_WON' | 'LEAD_LOST' | 'MESSAGE_COPIED' | 'MESSAGE_MARKED_SENT' | 'REVIEW_REQUEST_CREATED' | 'REVIEW_REQUEST_SENT' | 'REVIEW_OPENED' | 'REVIEW_RECEIVED' | 'FEEDBACK_RECEIVED' | 'REMINDER_CREATED' | 'REMINDER_SENT' | 'REMINDER_COMPLETED' | 'REMINDER_DISMISSED' | 'CUSTOMER_CREATED' | 'CUSTOMER_UPDATED';

export interface UserDto { id: string; email: string; fullName: string; hasPassword?: boolean; authProviders?: ('GOOGLE' | 'APPLE')[]; }
export interface BusinessDto { id: string; ownerId?: string; name: string; industry: string | null; country?: string | null; phone: string | null; description?: string | null; googleReviewLink?: string | null; workingHours?: Record<string, unknown> | null; defaultServices?: string[] | null; reminderDays?: number; preferredTone?: MessageTone; publicSlug?: string | null; createdAt?: string; updatedAt?: string; }
export interface SessionTokens { accessToken: string; refreshToken: string; expiresIn: number; tokenType: 'Bearer'; token?: string; }
export interface AuthResponse extends SessionTokens { user: UserDto; business: BusinessDto | null; role?: string | null; isNewUser?: boolean; }
export type RefreshResponse = SessionTokens;
export interface MeResponse { user: UserDto; business: BusinessDto | null; role: string | null; }
export type BusinessRole = 'OWNER' | 'ADMIN' | 'STAFF';
export type MembershipStatus = 'ACTIVE' | 'SUSPENDED';
export interface TeamMemberDto { id: string; userId: string; name: string; email: string; role: BusinessRole; status: MembershipStatus; joinedAt: string; }
export type TeamInvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
export interface TeamInvitationDto { id: string; invitedEmail: string; role: Exclude<BusinessRole, 'OWNER'>; status: TeamInvitationStatus; expiresAt: string; createdAt: string; acceptedAt: string | null; revokedAt: string | null; }
export interface CreatedTeamInvitationDto { id: string; email: string; role: Exclude<BusinessRole, 'OWNER'>; status: 'PENDING'; expiresAt: string; token: string; emailSent: boolean; }
export interface TeamSeatSummaryDto { seats: { activeMembers: number; pendingReservations: number; current: number; limit: number; remaining: number; }; }
export interface PublicTeamInvitationDto { state: 'open' | 'accepted' | 'expired' | 'revoked'; business?: { name: string }; email?: string; role?: Exclude<BusinessRole, 'OWNER'>; }

export interface CustomerDto { id: string; businessId: string; name: string; phone: string | null; email: string | null; notes: string | null; createdAt: string; updatedAt: string; }
export interface CustomerListResponse { items: CustomerDto[]; total: number; page: number; pageSize: number; }
export interface BulkImportCustomersResultDto { created: { id: string; name: string }[]; skipped: { name: string; reason: 'duplicate_phone' | 'limit_reached' }[]; failed: { name: string; reason: string }[]; }
export interface MessageDto { id: string; body: string; status: MessageStatus; channel: MessageChannel; messageType?: MessageType; automationRunId?: string | null; sentAt: string | null; createdAt: string; }
export type LeadPaymentStatus = 'unpaid' | 'partially_paid' | 'paid';
export interface LeadDto { id: string; businessId: string; customerId: string | null; source: string | null; missedCallTime: string | null; serviceRequested: string | null; urgency: LeadUrgency; status: LeadStatus; estimatedValue: string | number | null; paymentStatus: LeadPaymentStatus; paidAmount: string | number | null; notes: string | null; generatedReply: string | null; contactedAt: string | null; bookedAt: string | null; wonAt: string | null; lostAt: string | null; createdAt: string; updatedAt: string; responseTimeSeconds?: number | null; customer?: CustomerDto | null; messages?: MessageDto[]; referredByCustomerId?: string | null; referredBy?: CustomerDto | null; }
export interface LeadListResponse { items: LeadDto[]; total: number; page: number; pageSize: number; }
export interface ReviewRequestDto { id: string; businessId: string; customerId: string | null; serviceName: string | null; message: string | null; status: ReviewStatus; googleReviewLink: string | null; privateFeedbackUrl: string | null; sentAt: string | null; createdAt: string; updatedAt: string; customer?: CustomerDto | null; feedback?: FeedbackDto[]; }
export interface FeedbackDto { id: string; businessId: string; customerId: string | null; reviewRequestId: string | null; rating: number; comment: string | null; sentiment: FeedbackSentiment | null; status: FeedbackStatus; createdAt: string; customer?: CustomerDto | null; }
export interface ReminderDto { id: string; businessId: string; customerId: string | null; serviceName: string | null; lastVisitDate: string | null; dueDate: string; message: string | null; status: ReminderStatus; isDueNow: boolean; createdAt: string; updatedAt: string; customer?: CustomerDto | null; }
export interface MessageTemplateDto { id: string; businessId: string; templateType: MessageType; name: string; body: string; tone: MessageTone; isDefault: boolean; createdAt: string; updatedAt: string; }
export interface ActivityEventDto { id: string; eventType: ActivityEventType; entityType: string; entityId: string; metadata: Record<string, unknown> | null; createdAt: string; }

// Conversation & Communication Center (Stage 9)
export type CommunicationEventKind = 'lead_created' | 'missed_call_recovered' | 'follow_up_manual' | 'follow_up_automated' | 'review_requested' | 'review_completed' | 'reminder_created' | 'reminder_completed' | 'payment_recorded';
export type CommunicationFilter = 'needs_action' | 'automated' | 'manual' | 'reviews' | 'payments' | 'recovery';
export type CommunicationTone = 'default' | 'success' | 'attention';
export type CommunicationTimelineSource = { type: 'lead'; leadId: string } | { type: 'reviewRequest'; reviewRequestId: string } | { type: 'reminder' } | { type: 'message' };
export interface CommunicationTimelineEntryDto { id: string; kind: CommunicationEventKind; at: string; title: string; detail: string | null; tone: CommunicationTone; filters: CommunicationFilter[]; source: CommunicationTimelineSource; }
export type CommunicationStatus = 'waiting_for_follow_up' | 'waiting_for_review' | 'reminder_scheduled' | 'payment_outstanding' | 'customer_returned' | 'dormant';
export type CustomerCoachingQuickAction = 'recordPayment' | 'createReminder' | 'requestReview';
export interface CustomerCoachingHighlightDto { title: string; evidence: string[]; recommendedAction: string; quickAction: CustomerCoachingQuickAction; }
export type BusinessHealthLabel = 'excellent' | 'good' | 'needs_attention' | 'at_risk';
export type BusinessHealthFactorKey = 'contactRate' | 'conversionRate' | 'reviewConversion' | 'comebackCompletion' | 'profileCompleteness' | 'paymentCollectionRate';
export interface BusinessHealthFactorDto { key: BusinessHealthFactorKey; label: string; value: number | null; included: boolean; }
export interface CustomerNeedingFollowUpDto { customerId: string; customerName: string | null; reason: 'new_lead' | 'comeback_due'; }
export interface CustomerIntelligenceDto {
  totalCustomers: number;
  newCustomersThisPeriod: number;
  customersWithWonLead: number;
  returningCustomers: number;
  repeatCustomerRate: number | null;
  averageLifetimeValue: number | null;
  averageRecoveryDays: number | null;
  needingFollowUp: CustomerNeedingFollowUpDto[];
  needingFollowUpTotalCount: number;
  topCustomersByValue: { customerId: string; lifetimeValue: number }[];
}
export type RecommendationSeverity = 'info' | 'attention';
export interface RecommendationDto { key: string; message: string; severity: RecommendationSeverity; }
export interface DashboardSummaryDto { recoveredRevenue: { total: number; missedCall: number; comebackCompletedCount: number; outstanding: number }; businessHealth: { score: number | null; label: BusinessHealthLabel | null; factors: BusinessHealthFactorDto[] }; customerIntelligence: CustomerIntelligenceDto; recommendations: RecommendationDto[]; leads: { missedCalls: number; new: number; contacted: number; booked: number; won: number; lost: number; total: number; conversionRate: number; contactRate: number }; reviews: { requestsSent: number; reviewsReceived: number; feedbackReceived: number }; customersDue: number; responseTime: { averageSeconds: number | null; sampleSize: number }; recentActivity: ActivityEventDto[]; todayAttentionItems: { type: 'reminder_due'; id: string; customerName: string | null; dueDate: string }[]; generatedAt: string; windowStart: string; }
export interface CustomerProfileDto {
  customer: CustomerDto;
  leads: LeadDto[];
  reviewRequests: ReviewRequestDto[];
  feedback: FeedbackDto[];
  reminders: ReminderDto[];
  activity: ActivityEventDto[];
  messages: MessageDto[];
  lifetimeValue: number;
  lifecycleStage: CustomerLifecycleStage;
  communicationStatuses: CommunicationStatus[];
  communicationTimeline: CommunicationTimelineEntryDto[];
  assistantHighlight: CustomerCoachingHighlightDto | null;
}

export interface MonthlyTrendPointDto {
  month: string;
  newLeads: number;
  wonLeads: number;
  conversionRate: number | null;
  newCustomers: number;
  returningCustomers: number;
  recoveredRevenue: number;
  reviewRequestsSent: number;
  reviewsReceived: number;
  remindersCompleted: number;
}
export interface ServicePerformanceRowDto { service: string; leadCount: number; wonCount: number; conversionRate: number; revenue: number; }
export interface ServicePerformanceDto {
  mostRequested: ServicePerformanceRowDto[];
  highestRevenue: ServicePerformanceRowDto[];
  highestConverting: ServicePerformanceRowDto[];
  lowestConverting: ServicePerformanceRowDto[];
}
export interface FastestReturningCustomerDto { customerId: string; customerName: string | null; averageDaysBetweenWins: number; }
export interface LongestInactiveCustomerDto { customerId: string; customerName: string | null; daysSinceLastActivity: number; }
export interface CustomerValueAnalyticsDto {
  fastestReturningCustomers: FastestReturningCustomerDto[];
  longestInactiveCustomers: LongestInactiveCustomerDto[];
  atRiskCustomers: CustomerNeedingFollowUpDto[];
  repeatCustomers: { customerId: string; lifetimeValue: number }[];
}
export interface RecoveryPerformanceDto {
  missedCallsRecovered: number;
  missedCallsTotal: number;
  recoverySuccessRate: number;
  recoveryConversionRate: number;
  reviewRequestSuccessRate: number | null;
  reminderCompletionRate: number | null;
  averageRecoveryDays: number | null;
}
export type CustomerLifecycleStage = 'lost' | 'new_lead' | 'contacted' | 'dormant' | 'vip' | 'loyal' | 'returning' | 'first_customer';
export type SmartAudienceKey = 'new' | 'returning' | 'loyal' | 'vip' | 'dormant' | 'high_value' | 'outstanding_payments' | 'needs_reviews' | 'active_reminders';
export interface AudienceSummaryDto { key: SmartAudienceKey; label: string; customerIds: string[]; totalCustomers: number; averageValue: number; repeatRate: number | null; revenue: number; outstandingPayments: number; }
export interface AudienceCenterDto { audiences: AudienceSummaryDto[]; members: { customerId: string; name: string; lifecycleStage: CustomerLifecycleStage; lifetimeValue: number; outstandingAmount: number; manualTagIds: string[]; systemTags: string[] }[]; tags: { id: string; businessId: string; name: string; createdAt: string }[]; }
export interface CustomerLifecycleBreakdownDto {
  counts: Record<CustomerLifecycleStage, number>;
  totalCustomers: number;
}
export interface BusinessInsightsDto {
  monthlyTrend: MonthlyTrendPointDto[];
  servicePerformance: ServicePerformanceDto;
  customerValue: CustomerValueAnalyticsDto;
  recoveryPerformance: RecoveryPerformanceDto;
  customerLifecycle: CustomerLifecycleBreakdownDto;
  generatedAt: string;
  windowStart: string;
}
export type AttentionCategory = 'missed_call_followup' | 'customer_due' | 'review_opportunity' | 'payment_outstanding';
export interface AttentionItemDto { category: AttentionCategory; id: string; customerId: string | null; customerName: string | null; customerPhone: string | null; detail: string | null; occurredAt: string; message: string | null; amount: number | null; }

export type CoachingPriority = 'critical' | 'high' | 'medium' | 'low';
export type CoachingActionLinkDto =
  | { kind: 'attentionCenter'; category: AttentionCategory }
  | { kind: 'customerProfile'; customerId: string }
  | { kind: 'comeback' }
  | { kind: 'businessSettings' }
  | { kind: 'insights' };
export interface CoachingInsightDto {
  key: string;
  title: string;
  context: string;
  whyItMatters: string;
  evidence: string[];
  recommendedAction: string;
  actionLink: CoachingActionLinkDto;
  expectedOutcome: string;
  priority: CoachingPriority;
}
export interface BusinessCoachingDto { insights: CoachingInsightDto[]; generatedAt: string; }
export interface AttentionPageDto { items: AttentionItemDto[]; total: number; page: number; pageSize: number; category: AttentionCategory | null; countsByCategory?: Record<AttentionCategory, number>; }

export interface ApiErrorBody { error: { code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL_ERROR' | string; message: string; details?: unknown }; }

export type SubscriptionPlan = 'FREE' | 'PRO' | 'BUSINESS';
export type SubscriptionStatusValue = 'ACTIVE' | 'TRIALING' | 'GRACE_PERIOD' | 'EXPIRED' | 'CANCELED';
export interface MonthlyUsageDto { current: number; limit: number | null; period: 'month'; resetsAt: string; }
export interface StandingUsageDto { current: number; limit: number | null; period: null; resetsAt: null; }
export interface SubscriptionStatusDto {
  plan: SubscriptionPlan;
  status: SubscriptionStatusValue;
  provider: 'APPLE' | 'GOOGLE' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  features: { automation: boolean; outboundMessaging: boolean; advancedAnalytics: boolean; extendedHistory: boolean; unlimitedTemplates: boolean; teamManagement: boolean };
  usage: {
    leads: MonthlyUsageDto;
    reviewRequests: MonthlyUsageDto;
    customers: StandingUsageDto;
    openReminders: StandingUsageDto;
    customTemplates: { limitPerType: number | null; usageByType: Record<MessageType, number> };
  };
}
