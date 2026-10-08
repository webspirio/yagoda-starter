import { NetworkSettings } from './network-settings.entity';

export interface NetworkSettingsResponse {
  receipt_note: string | null;
  updated_at: string;
}

export const toNetworkSettingsResponse = (s: NetworkSettings): NetworkSettingsResponse => ({
  receipt_note: s.receipt_note,
  updated_at: s.updated_at.toISOString(),
});
