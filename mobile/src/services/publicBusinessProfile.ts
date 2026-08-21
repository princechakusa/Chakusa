import { PublicBusinessProfileDetails } from '../domain/publicBusinessProfile';
import { api } from './api';

const pathFor = (slug: string) => `/public/business/${encodeURIComponent(slug)}`;

export interface SubmitPublicContactInput {
  name: string;
  phone: string;
  serviceRequested?: string;
  message?: string;
  ref?: string;
}

export const publicBusinessProfileApi = {
  get: (slug: string) => api.get<PublicBusinessProfileDetails>(pathFor(slug), 'none'),
  submitContact: (slug: string, input: SubmitPublicContactInput) =>
    api.post<{ state: 'submitted'; businessName: string }>(`${pathFor(slug)}/contact`, input, 'none'),
};
