import api from './client';
import type { LicenseStatus } from './types';

export const licenseApi = {
  getStatus: () => api.get<LicenseStatus>('/license/status'),

  activate: (licenseKey?: string) =>
    api.put('/license/activate', { license_key: licenseKey }),

  checkFeature: (feature: string) =>
    api.post('/license/check-feature', null, { params: { feature } }),
};
