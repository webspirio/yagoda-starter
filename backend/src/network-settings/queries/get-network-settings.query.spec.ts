import { GetNetworkSettingsQuery } from './get-network-settings.query';

describe('GetNetworkSettingsQuery', () => {
  it('returns the one row', async () => {
    const at = new Date('2026-10-08T09:00:00.000Z');
    const repo = {
      findOneByOrFail: jest.fn().mockResolvedValue({ id: true, receipt_note: 'текст', updated_at: at }),
    };
    const query = new GetNetworkSettingsQuery(repo as never);

    await expect(query.get()).resolves.toEqual({
      receipt_note: 'текст',
      updated_at: at.toISOString(),
    });
    expect(repo.findOneByOrFail).toHaveBeenCalledWith({ id: true });
  });
});
