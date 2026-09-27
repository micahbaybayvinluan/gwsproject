import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEYS, ROLE_BY_KEY } from '../common/permissions';
import type { SessionUser } from '../common/request-context';
import { loadGuideFile, parseGuide, searchSections, sectionsFor } from './guide';
import { HelpService } from './help.service';

const guide = parseGuide(loadGuideFile());
const perms = (role: string) => new Set(ROLE_BY_KEY[role].permissions);
const user = (role: string): SessionUser => ({ id: `u-${role}`, username: role, fullName: `Test ${role}`, roleKey: role, permissions: perms(role), locationIds: [], locationScoped: false, sessionId: 's', totpVerified: true });

describe('user guide', () => {
  it('every section names real permissions (a typo would hide it from everyone)', () => {
    expect(guide.sections.length).toBeGreaterThan(30);
    const known = new Set<string>(PERMISSION_KEYS);
    for (const s of guide.sections) if (s.roles !== 'all') for (const k of s.roles) expect(known.has(k), `${s.title}: ${k}`).toBe(true);
    expect(new Set(guide.sections.map((s) => s.id)).size).toBe(guide.sections.length);
  });
  it('shows each role only its own sections', () => {
    const titles = (role: string) => sectionsFor(guide, perms(role)).map((s) => s.title);
    expect(titles('SALES_ASSOCIATE')).toContain('Recording a sale');
    expect(titles('SALES_ASSOCIATE')).not.toContain('HR: charge forms');
    expect(titles('SALES_ASSOCIATE')).not.toContain('Financial statements');
    expect(titles('HR_STAFF')).toContain('HR: charge forms');
    expect(titles('HR_STAFF')).not.toContain('Recording a sale');
    expect(titles('FIELD_AUDITOR')).toContain('Store inspection report');
    expect(titles('FIELD_AUDITOR')).not.toContain('Recording a sale');
    expect(titles('ADMIN').length).toBe(guide.sections.length);
  });
  it('keyword search finds the right section', () => {
    const mine = sectionsFor(guide, perms('SALES_ASSOCIATE'));
    expect(searchSections(mine, 'how do I record a delivery sale with a rider?')[0].title).toMatch(/delivery/i);
    expect(searchSections(mine, 'paano mag weekly count')[0].title).toMatch(/Weekly count/);
    expect(searchSections(mine, 'the and for')).toEqual([]);
  });
});

describe('guides per role', () => {
  it('every role has its own step-by-step guide, and the Help page returns it with the guide for everyone', () => {
    const rg = parseGuide(loadGuideFile('ROLE-GUIDES.md'));
    for (const role of Object.keys(ROLE_BY_KEY)) expect(rg.sections.filter((s) => s.roleKeys?.includes(role)), role).toHaveLength(1);
    const h = new HelpService().sections(user('SALES_ASSOCIATE'));
    expect(h.roleGuide[0].title).toMatch(/Sales Associate/); expect(h.roleGuide[0].body).toMatch(/true and correct/);
    expect(h.everyone.every((x) => x.roles === 'all')).toBe(true); expect(h.topics.some((x) => x.title === 'Recording a sale')).toBe(true);
    expect(h.allRoleGuides).toBeUndefined(); expect(new HelpService().sections(user('ADMIN')).allRoleGuides!.length).toBe(Object.keys(ROLE_BY_KEY).length);
    expect(new HelpService().sections(user('HR_STAFF')).roleGuide[0].body).not.toMatch(/New Sale/);
  });
});

describe('help assistant', () => {
  afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  it('without an API key answers with guide sections', async () => {
    const r = await new HelpService().ask('How do I request stock from the warehouse?', [], user('SALES_ASSOCIATE'));
    expect(r.mode).toBe('guide'); expect(r.answer).toBeNull(); expect(r.sections[0].title).toMatch(/Requesting stock/);
  });
  it('with a key sends the cached guide, the role and the question to Claude and returns its answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const svc = new HelpService();
    const create = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '1. Open Transfers.\n2. Use Request stock from the warehouse.' }] });
    (svc as unknown as { client: unknown }).client = { beta: { messages: { create } } };
    const r = await svc.ask('How do I request stock?', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello' }], user('SALES_ASSOCIATE'));
    expect(r.mode).toBe('ai'); expect(r.answer).toContain('Open Transfers');
    const req = create.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-5'); expect(req.fallbacks).toBe('default'); expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' }); expect(req.system[0].text).toContain('## Recording a sale');
    expect(req.system[1].text).toContain('Sales Associate'); expect(req.system[0].text).not.toContain('Sales Associate, role');
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'How do I request stock?' }); expect(req.messages).toHaveLength(3);
  });
  it('falls back to the guide when Claude refuses or the service fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const svc = new HelpService();
    const create = vi.fn().mockResolvedValueOnce({ stop_reason: 'refusal', content: [] }).mockRejectedValueOnce(new Error('network down'));
    (svc as unknown as { client: unknown }).client = { beta: { messages: { create } } };
    const a = await svc.ask('How do I void a sale?', [], user('SALES_ASSOCIATE'));
    expect(a.mode).toBe('guide'); expect(a.note).toMatch(/could not answer/);
    const b = await svc.ask('How do I void a sale?', [], user('SALES_ASSOCIATE'));
    expect(b.mode).toBe('guide'); expect(b.sections[0].title).toMatch(/Voiding/); expect(b.note).toMatch(/not available/);
  });
});

describe('guide sections by job', () => {
  it('sales associates do not get the warehouse or audit-count sections; the Field Auditor gets audit counts', () => {
    const titles = (role: string) => sectionsFor(guide, perms(role)).map((s) => s.title);
    for (const t of ['Warehouse: sending stock', "Warehouse In-Charge: correcting an associate's entry", 'Audit count (auditors and Field Auditor)']) expect(titles('SALES_ASSOCIATE')).not.toContain(t);
    expect(titles('WAREHOUSE_ASSOCIATE')).toContain('Warehouse: sending stock');
    expect(titles('FIELD_AUDITOR')).toContain('Audit count (auditors and Field Auditor)');
    expect(titles('HEAD_AUDITOR')).toContain('Audit count (auditors and Field Auditor)');
  });
});
