// TEMPORARY (#238): changes the backend's turbo input hash so the coverage leg runs for
// real on PR #239. Reverted in the next commit.
describe('ci probe', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
