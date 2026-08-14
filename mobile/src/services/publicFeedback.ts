import { PublicReviewResponse } from '../domain/publicFeedback';
import { api } from './api';

const pathFor = (token: string) => `/public/reviews/${encodeURIComponent(token)}`;

export const publicFeedbackApi = {
  get: (token: string) => api.get<PublicReviewResponse>(pathFor(token), 'none'),
  submit: (token: string, rating: number, comment?: string) => api.post<{ state: 'submitted' | 'expired' }>(`${pathFor(token)}/feedback`, { rating, ...(comment ? { comment } : {}) }, 'none'),
};

